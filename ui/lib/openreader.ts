import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { openreaderConnections } from "@/db/schema";
import { baseUrl } from "@/lib/base-url";
import { seal, unseal } from "@/lib/crypto";
import { getSettings } from "@/lib/settings/store";

/**
 * Speech comes from an OpenReader instance the user connects with OAuth. This app
 * is a public client: its client ID is the URL of its client metadata document,
 * or, where that URL can't be public (local development), a client registered
 * on each connect.
 */

export const SCOPES = "audio:generate documents:read offline_access";
export const METADATA_PATH = "/oauth/client-metadata.json";
export const CALLBACK_PATH = "/api/openreader/callback";
export const STATE_COOKIE = "openreader_oauth";
export const SPEECH_MAX_CHARS = 2000;

const TOKEN_PURPOSE = "openreader-token";
const STATE_PURPOSE = "openreader-state";
const STATE_TTL_MS = 10 * 60_000;
const DISCOVERY_TTL_MS = 10 * 60_000;
// Refresh a little early, so a token doesn't expire between the check and the call.
const EXPIRY_MARGIN_MS = 60_000;

export class OpenReaderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code?: string,
    readonly retryAfter?: string | null,
  ) {
    super(message);
  }
}

export class NotConnected extends OpenReaderError {
  constructor(message = "Connect OpenReader in Settings → Speech first.") {
    super(message, 409, "NOT_CONNECTED");
  }
}

const b64url = (data: Buffer) => data.toString("base64url");

/** The configured instance's origin: the admin setting, else OPENREADER_URL. */
export async function openreaderOrigin(): Promise<string | null> {
  const configured = (await getSettings()).values.openreaderUrl ?? process.env.OPENREADER_URL ?? null;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function isLocal(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) || hostname.endsWith(".localhost");
}

/** This app's client ID metadata URL, when this app is served on public HTTPS. */
export function metadataClientId(env: Record<string, string | undefined> = process.env): string | null {
  const base = new URL(baseUrl(env));
  if (base.protocol !== "https:" || isLocal(base.hostname)) return null;
  return `${base.origin}${METADATA_PATH}`;
}

export function redirectUri(env: Record<string, string | undefined> = process.env): string {
  return `${new URL(baseUrl(env)).origin}${CALLBACK_PATH}`;
}

/** The client metadata document: what OpenReader shows on consent and checks redirects against. */
export function clientMetadata(env: Record<string, string | undefined> = process.env) {
  const origin = new URL(baseUrl(env)).origin;
  return {
    client_id: `${origin}${METADATA_PATH}`,
    client_name: new URL(origin).host,
    client_uri: origin,
    logo_uri: `${origin}/android-chrome-192x192.png`,
    redirect_uris: [redirectUri(env)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPES,
  };
}

// --- Discovery ---

type Server = {
  origin: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  metadataClients: boolean;
};

const servers = new Map<string, { at: number; server: Promise<Server> }>();

async function getJson(url: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new OpenReaderError("OpenReader can't be reached right now.", 503);
  }
  if (!res.ok) throw new OpenReaderError(`OpenReader answered ${res.status} for ${new URL(url).pathname}.`, 502);
  return (await res.json()) as Record<string, unknown>;
}

async function fetchServer(origin: string): Promise<Server> {
  const [resource, auth] = await Promise.all([
    getJson(`${origin}/.well-known/oauth-protected-resource/api/v1`),
    getJson(`${origin}/.well-known/oauth-authorization-server/api/auth`),
  ]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const server = {
    origin,
    resource: str(resource.resource),
    authorizationEndpoint: str(auth.authorization_endpoint),
    tokenEndpoint: str(auth.token_endpoint),
    registrationEndpoint: str(auth.registration_endpoint),
    revocationEndpoint: str(auth.revocation_endpoint),
    metadataClients: auth.client_id_metadata_document_supported === true,
  };
  if (!server.resource || !server.authorizationEndpoint || !server.tokenEndpoint) {
    throw new OpenReaderError("That address doesn't look like an OpenReader instance.", 502);
  }
  return server as Server;
}

export function discover(origin: string): Promise<Server> {
  const cached = servers.get(origin);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.server;
  const server = fetchServer(origin);
  servers.set(origin, { at: Date.now(), server });
  server.catch(() => servers.delete(origin));
  return server;
}

// --- Connecting ---

async function clientIdFor(server: Server): Promise<string> {
  const metadataId = metadataClientId();
  if (metadataId && server.metadataClients) return metadataId;
  if (!server.registrationEndpoint) {
    throw new OpenReaderError("This OpenReader doesn't accept new apps; an admin can allow them in its settings.", 503);
  }
  // Only metadata-document clients can show a logo, and the client ID is OpenReader's to assign.
  const { client_name, client_uri, redirect_uris, grant_types, response_types, token_endpoint_auth_method, scope } =
    clientMetadata();
  const metadata = { client_name, client_uri, redirect_uris, grant_types, response_types, token_endpoint_auth_method, scope };
  const loopback = isLocal(new URL(redirectUri()).hostname);
  const res = await fetch(server.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      ...metadata,
      // A loopback redirect is only allowed for native clients.
      application_type: loopback ? "native" : "web",
      resources: [server.resource],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
  if (!res.ok || !body.client_id) {
    throw new OpenReaderError(body.error_description || `OpenReader refused to register this app (${res.status}).`, 502);
  }
  return body.client_id;
}

type PendingConnect = { state: string; verifier: string; origin: string; clientId: string; userId: string; exp: number };

/** Where to send the user to approve access, and the sealed state for the callback. */
export async function beginConnect(userId: string): Promise<{ url: string; cookie: string }> {
  const origin = await openreaderOrigin();
  if (!origin) throw new OpenReaderError("No OpenReader instance is set up yet.", 503);
  const server = await discover(origin);
  const clientId = await clientIdFor(server);
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const url = new URL(server.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    resource: server.resource,
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  const pending: PendingConnect = { state, verifier, origin, clientId, userId, exp: Date.now() + STATE_TTL_MS };
  return { url: url.toString(), cookie: seal(JSON.stringify(pending), STATE_PURPOSE) };
}

function readPending(cookie: string | undefined): PendingConnect | null {
  if (!cookie) return null;
  try {
    return JSON.parse(unseal(cookie, STATE_PURPOSE)) as PendingConnect;
  } catch {
    return null;
  }
}

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(server: Server, form: Record<string, string>): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetch(server.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OpenReaderError("OpenReader can't be reached right now.", 503);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<Tokens> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new OpenReaderError(body.error_description || `OpenReader's token request failed (${res.status}).`, 502, body.error);
  }
  return body as Tokens;
}

const expiresAt = (tokens: Tokens) => new Date(Date.now() + (tokens.expires_in ?? 900) * 1000);

/** Finishes the OAuth callback: checks the state, trades the code and keeps the tokens. */
export async function finishConnect(userId: string, params: URLSearchParams, cookie: string | undefined): Promise<void> {
  const pending = readPending(cookie);
  const state = params.get("state") ?? "";
  if (
    !pending ||
    pending.exp < Date.now() ||
    pending.userId !== userId ||
    state.length !== pending.state.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
  ) {
    throw new OpenReaderError("That sign-in link expired or belongs to another session; connect again.", 400);
  }
  const error = params.get("error");
  if (error) {
    throw new OpenReaderError(error === "access_denied" ? "OpenReader access wasn't allowed." : params.get("error_description") || error, 400, error);
  }
  const code = params.get("code");
  if (!code) throw new OpenReaderError("OpenReader sent no authorization code.", 400);
  if ((await openreaderOrigin()) !== pending.origin) throw new OpenReaderError("The OpenReader instance changed; connect again.", 400);

  const server = await discover(pending.origin);
  const tokens = await tokenRequest(server, {
    grant_type: "authorization_code",
    client_id: pending.clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
    resource: server.resource,
  });
  if (!tokens.refresh_token) throw new OpenReaderError("OpenReader gave no refresh token, so access would end in minutes.", 502);

  const [existing] = await db.select().from(openreaderConnections).where(eq(openreaderConnections.userId, userId));
  const values = {
    origin: pending.origin,
    clientId: pending.clientId,
    accessToken: seal(tokens.access_token, TOKEN_PURPOSE),
    accessExpiresAt: expiresAt(tokens),
    refreshToken: seal(tokens.refresh_token, TOKEN_PURPOSE),
    scope: tokens.scope ?? SCOPES,
    // Voices belong to one instance's providers; keep them only on the same instance.
    hostVoices: existing?.origin === pending.origin ? existing.hostVoices : [],
    updatedAt: new Date(),
  };
  await db
    .insert(openreaderConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: openreaderConnections.userId, set: values });
}

// --- Using the connection ---

type Connection = typeof openreaderConnections.$inferSelect;

async function current(userId: string): Promise<{ row: Connection; server: Server }> {
  const origin = await openreaderOrigin();
  if (!origin) throw new OpenReaderError("No OpenReader instance is set up yet.", 503);
  const [row] = await db.select().from(openreaderConnections).where(eq(openreaderConnections.userId, userId));
  if (!row || row.origin !== origin) throw new NotConnected();
  return { row, server: await discover(origin) };
}

const fresh = (row: Connection) => row.accessExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS;

// Refresh tokens rotate with no reuse window, so one refresh per user at a time:
// this map within a process, the row lock across replicas.
const refreshing = new Map<string, Promise<string>>();

function refreshOnce(userId: string, server: Server, stale: string | null): Promise<string> {
  const running = refreshing.get(userId);
  if (running) return running;
  const promise = refresh(userId, server, stale).finally(() => refreshing.delete(userId));
  refreshing.set(userId, promise);
  return promise;
}

async function refresh(userId: string, server: Server, stale: string | null): Promise<string> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(openreaderConnections)
      .where(eq(openreaderConnections.userId, userId))
      .for("update");
    if (!row || row.origin !== server.origin) return { gone: true as const };
    // Another request may have refreshed while this one waited for the lock.
    if (row.accessToken !== stale && fresh(row)) return { token: unseal(row.accessToken, TOKEN_PURPOSE) };
    let tokens: Tokens;
    try {
      tokens = await tokenRequest(server, {
        grant_type: "refresh_token",
        client_id: row.clientId,
        refresh_token: unseal(row.refreshToken, TOKEN_PURPOSE),
        resource: server.resource,
      });
    } catch (e) {
      if (e instanceof OpenReaderError && (e.code === "invalid_grant" || e.code === "invalid_client")) {
        await tx.delete(openreaderConnections).where(eq(openreaderConnections.userId, userId));
        return { gone: true as const };
      }
      throw e;
    }
    await tx
      .update(openreaderConnections)
      .set({
        accessToken: seal(tokens.access_token, TOKEN_PURPOSE),
        accessExpiresAt: expiresAt(tokens),
        ...(tokens.refresh_token ? { refreshToken: seal(tokens.refresh_token, TOKEN_PURPOSE) } : {}),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        updatedAt: new Date(),
      })
      .where(eq(openreaderConnections.userId, userId));
    return { token: tokens.access_token };
  });
  if ("gone" in outcome) throw new NotConnected("OpenReader access ended; connect it again in Settings → Speech.");
  return outcome.token;
}

/** A v1 API request as the user, refreshing the access token when it has expired or is refused. */
export async function openreaderFetch(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const { row, server } = await current(userId);
  const call = (token: string) =>
    fetch(`${server.resource}${path}`, {
      ...init,
      cache: "no-store",
      headers: { accept: "application/json", ...init.headers, authorization: `Bearer ${token}` },
    });
  const token = fresh(row) ? unseal(row.accessToken, TOKEN_PURPOSE) : await refreshOnce(userId, server, null);
  const res = await call(token);
  if (res.status !== 401) return res;
  return call(await refreshOnce(userId, server, row.accessToken));
}

async function apiError(res: Response, fallback: string): Promise<OpenReaderError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const code = body?.error?.code;
  if (res.status === 401 || res.status === 403) {
    return new NotConnected("OpenReader didn't allow this; connect it again in Settings → Speech.");
  }
  const status = res.status === 429 || res.status === 400 || res.status === 503 ? res.status : 502;
  return new OpenReaderError(body?.error?.message || fallback, status, code, res.headers.get("retry-after"));
}

export type ConnectionStatus = {
  configured: boolean;
  origin: string | null;
  connected: boolean;
  hostVoices: string[];
};

export async function connectionStatus(userId: string): Promise<ConnectionStatus> {
  const origin = await openreaderOrigin();
  const [row] = await db.select().from(openreaderConnections).where(eq(openreaderConnections.userId, userId));
  const connected = Boolean(origin && row && row.origin === origin);
  return { configured: Boolean(origin), origin, connected, hostVoices: connected ? row.hostVoices : [] };
}

export async function saveHostVoices(userId: string, voices: string[]): Promise<void> {
  const { row } = await current(userId);
  await db
    .update(openreaderConnections)
    .set({ hostVoices: voices, updatedAt: new Date() })
    .where(eq(openreaderConnections.userId, row.userId));
}

/** Forgets the connection and, as a courtesy, revokes its refresh token on OpenReader. */
export async function disconnect(userId: string): Promise<void> {
  const [row] = await db
    .delete(openreaderConnections)
    .where(eq(openreaderConnections.userId, userId))
    .returning();
  if (!row) return;
  try {
    const server = await discover(row.origin);
    if (!server.revocationEndpoint) return;
    await fetch(server.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: unseal(row.refreshToken, TOKEN_PURPOSE),
        token_type_hint: "refresh_token",
        client_id: row.clientId,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The user can still disconnect the app from OpenReader's Connected apps.
  }
}

export type Voices = { voices: { id: string; name: string }[]; provider: string | null; model: string | null };

export async function listVoices(userId: string): Promise<Voices> {
  const res = await openreaderFetch(userId, "/voices", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await apiError(res, "Couldn't list OpenReader's voices.");
  const body = (await res.json()) as { data?: { id: string; name: string }[]; provider?: string; model?: string };
  return { voices: body.data ?? [], provider: body.provider ?? null, model: body.model ?? null };
}

/** MP3 for `text`, in podcast host `speaker`'s voice (host 0 also reads replies aloud). */
export async function speak(userId: string, text: string, speaker = 0, signal?: AbortSignal): Promise<ArrayBuffer> {
  const { row } = await current(userId);
  // An unset voice uses the one saved on OpenReader.
  const voice = row.hostVoices[speaker % 2] ?? "";
  const res = await openreaderFetch(userId, "/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
    signal,
  });
  if (!res.ok) throw await apiError(res, `OpenReader speech failed (${res.status}).`);
  return res.arrayBuffer();
}
