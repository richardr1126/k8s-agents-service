import { generateTTSBuffer } from "./generate";
import { defaultModelForProviderType, defaultVoiceForProviderType } from "./provider-policy";
import { defaultProvider, getSpeechSettings, ProviderError, resolveProvider } from "./providers";

export type SpeakInput = {
  text: string;
  /** Podcast host 0 or 1: uses that host's voice from the speech settings. */
  speaker?: number;
  /** An explicit voice, overriding the speaker's. */
  voice?: string;
  /** A provider slug, overriding the speech settings. */
  provider?: string;
};

/** MP3 audio for `text`, spoken by the configured provider and voice. */
export async function speak(input: SpeakInput, signal?: AbortSignal): Promise<Buffer> {
  const speech = await getSpeechSettings();
  const slug = input.provider ?? speech.provider;
  const provider = slug ? await resolveProvider({ slug }) : await defaultProvider();
  if (!provider) throw new ProviderError("No speech provider is set up. Add one in Settings → Speech.", 503);
  if (!provider.enabled) throw new ProviderError(`${provider.displayName} is turned off.`, 503);

  const hostVoice = input.speaker === undefined ? "" : speech.hostVoices[input.speaker % 2];
  const voice =
    input.voice || hostVoice || provider.defaultVoice || defaultVoiceForProviderType(provider.providerType);
  return generateTTSBuffer(
    {
      text: input.text,
      voice,
      speed: speech.speed,
      format: "mp3",
      model: provider.defaultModel || defaultModelForProviderType(provider.providerType),
      provider: provider.providerType,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl ?? undefined,
      ...(provider.defaultInstructions ? { instructions: provider.defaultInstructions } : {}),
      ...(provider.defaultModelOptions ? { modelOptions: provider.defaultModelOptions } : {}),
    },
    signal,
  );
}
