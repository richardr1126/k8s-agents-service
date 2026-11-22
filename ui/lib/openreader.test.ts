import { describe, expect, test, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/settings/store", () => ({ getSettings: async () => ({ values: { openreaderUrl: null } }) }));

const { clientMetadata, metadataClientId, redirectUri, SCOPES } = await import("@/lib/openreader");

const PROD = { BASE_URL: "https://chat.richardr.dev" };

describe("client metadata document", () => {
  test("names its own URL as the client ID and only its own redirect", () => {
    const doc = clientMetadata(PROD);
    expect(doc.client_id).toBe("https://chat.richardr.dev/oauth/client-metadata.json");
    expect(doc.client_id).toBe(metadataClientId(PROD));
    expect(doc.client_name).toBe("chat.richardr.dev");
    expect(doc.redirect_uris).toEqual(["https://chat.richardr.dev/api/openreader/callback"]);
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(doc.scope).toBe(SCOPES);
    // OpenReader takes a logo only from the client ID's origin.
    expect(new URL(doc.logo_uri).origin).toBe("https://chat.richardr.dev");
  });

  test("keeps the client ID short enough and ignores a trailing slash or path", () => {
    const env = { BASE_URL: "https://chat.richardr.dev/" };
    expect(metadataClientId(env)!.length).toBeLessThanOrEqual(512);
    expect(redirectUri(env)).toBe("https://chat.richardr.dev/api/openreader/callback");
  });

  test("local development registers a client instead", () => {
    expect(metadataClientId({ BASE_URL: "http://localhost:3000" })).toBeNull();
    expect(metadataClientId({ BASE_URL: "https://app.localhost" })).toBeNull();
    expect(metadataClientId({})).toBeNull();
  });
});
