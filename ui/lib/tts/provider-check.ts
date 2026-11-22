import { generateTTSBuffer } from "./generate";
import type { TtsProviderId } from "./provider-catalog";
import {
  defaultBaseUrlForProviderType,
  defaultModelForProviderType,
  defaultVoiceForProviderType,
} from "./provider-policy";
import { resolveVoices } from "./voice-resolution";

/**
 * Checks a provider the way speech will use it: required settings, the key
 * against the provider's API, the voice list, then one short sample spoken
 * in-process. Ported from OpenReader; the key never appears in a result.
 */

export type CheckStatus = "ok" | "warn" | "error" | "skipped";
export type CheckItem = { id: string; label: string; status: CheckStatus; detail: string };

export interface CheckDraft {
  providerType: TtsProviderId;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultVoice: string;
  defaultInstructions: string;
  defaultModelOptions: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const SPEECH_TIMEOUT_MS = 45_000;
const SAMPLE_TEXT = "This is a quick provider check.";
const KEY_REQUIRED: readonly TtsProviderId[] = ["openai", "google-ai-studio", "replicate", "fish-audio", "openrouter"];

const make =
  (id: string, label: string) =>
  (status: CheckStatus, detail: string): CheckItem => ({ id, label, status, detail });

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function checkSettings(draft: CheckDraft): CheckItem {
  const item = make("settings", "Settings");
  if (draft.providerType === "custom-openai") {
    if (!draft.baseUrl) return item("error", "Add the base URL of the OpenAI-compatible server.");
    let parsed: URL;
    try {
      parsed = new URL(draft.baseUrl);
    } catch {
      return item("error", "The base URL is not a valid URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return item("error", "The base URL must start with http:// or https://.");
    }
  }
  if (!draft.apiKey && KEY_REQUIRED.includes(draft.providerType)) return item("error", "This provider needs an API key.");
  return item("ok", "Required fields are filled in.");
}

function replicateEndpoint(model: string): string | null {
  const [ref, version] = model.split(":", 2);
  const [owner, name, extra] = ref.split("/");
  if (!owner || !name || extra !== undefined) return null;
  const base = `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  return version ? `${base}/versions/${encodeURIComponent(version)}` : base;
}

async function checkConnection(draft: CheckDraft, model: string, signal: AbortSignal): Promise<CheckItem> {
  const item = make("connection", "Connection");
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);

  if (draft.providerType === "replicate") {
    const endpoint = replicateEndpoint(model);
    if (!endpoint) return item("error", `${model} is not an owner/name Replicate model.`);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${draft.apiKey}` },
        signal: timeout,
        cache: "no-store",
      });
    } catch {
      return item("error", "Could not reach api.replicate.com from the server.");
    }
    if (response.status === 401 || response.status === 403) return item("error", "Replicate rejected the API key.");
    if (response.status === 404) return item("error", `Replicate has no model ${model}.`);
    if (!response.ok) return item("warn", `Replicate answered HTTP ${response.status}.`);
    return item("ok", "Replicate accepted the key and found the model.");
  }

  const fixed = draft.providerType === "openrouter" || draft.providerType === "google-ai-studio";
  const baseUrl = (
    fixed ? defaultBaseUrlForProviderType(draft.providerType) : draft.baseUrl || defaultBaseUrlForProviderType(draft.providerType)
  ).replace(/\/+$/, "");
  const host = hostOf(baseUrl);
  const url =
    draft.providerType === "google-ai-studio"
      ? `${baseUrl}/models/${encodeURIComponent(model)}`
      : draft.providerType === "openrouter"
        ? `${baseUrl}/key`
        : draft.providerType === "fish-audio"
          ? "https://api.fish.audio/model?page_size=1"
          : `${baseUrl}/models`;
  const headers: Record<string, string> = draft.apiKey
    ? draft.providerType === "google-ai-studio"
      ? { "x-goog-api-key": draft.apiKey }
      : { Authorization: `Bearer ${draft.apiKey}` }
    : {};
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: timeout, cache: "no-store", redirect: "error" });
  } catch {
    return item("error", `Could not reach ${host} from the server.`);
  }
  if (response.status === 401 || response.status === 403) return item("error", `${host} rejected the API key.`);
  // Many OpenAI-compatible TTS servers have no /models; an answer still proves reachability.
  if (response.status === 404 && draft.providerType === "custom-openai") return item("ok", `Connected to ${host}.`);
  if (!response.ok) return item("warn", `${host} answered HTTP ${response.status}.`);
  if (draft.providerType === "openai") {
    const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
    const ids = body?.data?.map((e) => e.id).filter((id): id is string => typeof id === "string") ?? [];
    if (ids.length > 0 && !ids.includes(model)) return item("warn", `Connected, but ${model} is not available to this key.`);
  }
  return item("ok", `Connected to ${host}.`);
}

async function checkSpeech(draft: CheckDraft, model: string, voice: string, signal: AbortSignal): Promise<CheckItem> {
  const item = make("speech", "Speech sample");
  try {
    const audio = await generateTTSBuffer(
      {
        text: SAMPLE_TEXT,
        voice,
        speed: 1,
        format: "mp3",
        model,
        provider: draft.providerType,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl || undefined,
        ...(draft.defaultInstructions ? { instructions: draft.defaultInstructions } : {}),
        ...(draft.defaultModelOptions ? { modelOptions: draft.defaultModelOptions } : {}),
      },
      AbortSignal.any([signal, AbortSignal.timeout(SPEECH_TIMEOUT_MS)]),
    );
    const kb = Math.max(1, Math.round(audio.byteLength / 1024));
    return item("ok", `Spoke a sample with ${voice} (${kb} KB).`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return item("error", "The provider rejected the API key.");
    if (status === 402) return item("error", "The provider account has no remaining credit.");
    if (status === 429) return item("warn", "The provider is busy or rate limited. Try again shortly.");
    if ((error as Error).name === "TimeoutError") return item("error", "The speech sample timed out.");
    const message = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
    return item("error", `The speech sample failed: ${message}`);
  }
}

export async function runProviderCheck(draft: CheckDraft, signal: AbortSignal): Promise<CheckItem[]> {
  const settings = checkSettings(draft);
  if (settings.status === "error") return [settings];
  const model = draft.defaultModel || defaultModelForProviderType(draft.providerType);
  const items: CheckItem[] = [settings];

  const connection = await checkConnection(draft, model, signal);
  items.push(connection);
  if (connection.status === "error") return items;

  let voices: string[] = [];
  let unconfirmed = false;
  try {
    const found = await resolveVoices({
      provider: draft.providerType,
      model,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl || defaultBaseUrlForProviderType(draft.providerType),
    });
    voices = found.voices;
    unconfirmed = found.status === "unreachable";
  } catch {
    voices = [];
  }
  const voiceItem = make("voices", "Voices");
  items.push(
    unconfirmed
      ? voiceItem("warn", "The provider did not return its voice list, so its standard voices are unconfirmed.")
      : voices.length > 0
        ? voiceItem("ok", `${voices.length} ${voices.length === 1 ? "voice" : "voices"} available.`)
        : voiceItem("warn", "No voices were found for this model."),
  );

  const preferred = draft.defaultVoice || defaultVoiceForProviderType(draft.providerType);
  const voice = voices.includes(preferred) || draft.defaultVoice ? preferred : (voices[0] ?? preferred);
  items.push(await checkSpeech(draft, model, voice, signal));
  return items;
}
