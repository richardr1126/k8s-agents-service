import { z } from "zod";
import { PROVIDER_TYPES, resolveProvider } from "@/lib/tts/providers";
import type { CheckDraft } from "@/lib/tts/provider-check";

/**
 * A provider as the editor dialog describes it. With `id` and no `apiKey`,
 * the saved key is used, so a saved provider can be checked without retyping it.
 */
export const draftSchema = z.object({
  id: z.string().optional(),
  providerType: z.enum(PROVIDER_TYPES),
  baseUrl: z.string().trim().max(500).optional().default(""),
  apiKey: z.string().trim().max(500).optional(),
  defaultModel: z.string().trim().max(200).optional().default(""),
  defaultVoice: z.string().trim().max(200).optional().default(""),
  defaultInstructions: z.string().trim().max(2000).optional().default(""),
  defaultModelOptions: z.string().trim().max(16_384).optional().default(""),
});

export async function toDraft(input: z.infer<typeof draftSchema>): Promise<CheckDraft> {
  let apiKey = input.apiKey ?? "";
  if (!apiKey && input.id) apiKey = (await resolveProvider({ id: input.id }))?.apiKey ?? "";
  return { ...input, apiKey };
}
