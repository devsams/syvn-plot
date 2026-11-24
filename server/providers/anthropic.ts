import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod/v4"

import { httpError, ProviderError, type ProviderResult } from "../agent"
import type { Prompt, SchemaId } from "../tasks"

const ZOD: Record<SchemaId, z.ZodObject> = {
  patch: z.object({ reply: z.string(), patches: z.array(z.object({ kind: z.enum(["updateDataModel", "updateComponents"]), path: z.string(), valueJson: z.string(), componentsJson: z.string() })) }),
  text: z.object({ reply: z.string(), legend: z.string(), methods: z.string() }),
  cleanup: z.object({ reply: z.string(), ops: z.array(z.object({ op: z.enum(["trim_whitespace", "merge_values", "to_number", "rename_column", "drop_rows", "drop_empty_rows", "drop_column", "fill_down", "wide_to_long"]), column: z.string(), argsJson: z.string() })) }),
}

const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"])

/** Maps SDK errors (typed classes, most specific first) to plain-language ProviderErrors. */
function mapError(e: unknown): never {
  if (e instanceof ProviderError) throw e
  if (e instanceof Anthropic.AuthenticationError) throw httpError("anthropic", 401)
  if (e instanceof Anthropic.PermissionDeniedError) throw httpError("anthropic", 403)
  if (e instanceof Anthropic.NotFoundError) throw httpError("anthropic", 404, e.message)
  if (e instanceof Anthropic.RateLimitError) throw httpError("anthropic", 429)
  if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("provider_error", "Couldn't reach Anthropic. Check your internet connection and try again.")
  if (e instanceof Anthropic.APIError) throw httpError("anthropic", e.status ?? 502, e.message)
  throw new ProviderError("provider_error", "Anthropic request failed. Try again in a moment.")
}

export async function anthropicChat(key: string, model: string, prompt: Prompt, schema: SchemaId): Promise<ProviderResult> {
  const client = new Anthropic({ apiKey: key })
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of prompt.history) messages.push({ role: m.role === "model" ? "assistant" : "user", content: m.text.slice(0, 4000) })
  while (messages[0]?.role === "assistant") messages.shift()
  messages.push({ role: "user", content: prompt.user })
  try {
    // Server-side refusal fallback exists only on some models (not on Haiku 5.5); send it only where supported.
    const fallback = FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      ...fallback,
      system: prompt.system,
      messages,
      output_config: { effort: prompt.effort, format: zodOutputFormat(ZOD[schema]) },
    })
    if (res.stop_reason === "refusal") throw new ProviderError("refused", "Claude declined this request. Try rephrasing it.")
    if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new ProviderError("bad_output", "Claude's answer was cut off or not in the expected format. Try again.")
    return { data: res.parsed_output, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }
  } catch (e) {
    mapError(e)
  }
}

export async function anthropicVerify(key: string) {
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0 }).models.list({ limit: 1 })
  } catch (e) {
    mapError(e)
  }
}
