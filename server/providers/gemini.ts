import { httpError, ProviderError, type ProviderResult } from "../agent"
import { JSON_SCHEMAS, type Prompt, type SchemaId } from "../tasks"

const BASE = "https://generativelanguage.googleapis.com/v1beta"

/** Gemini's responseSchema is an OpenAPI subset: uppercase types, no additionalProperties. */
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema)
  if (!s || typeof s !== "object") return s
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue
    out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v)
  }
  return out
}

export async function geminiChat(key: string, model: string, prompt: Prompt, schema: SchemaId): Promise<ProviderResult> {
  const contents = [
    ...prompt.history.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 4000) }] })),
    { role: "user", parts: [{ text: prompt.user }] },
  ]
  const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents,
      generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(JSON_SCHEMAS[schema]), temperature: 0.1, maxOutputTokens: 8192 },
    }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError("gemini", r.status, data?.error?.message)
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? ""
  try {
    return { data: JSON.parse(text), inputTokens: data?.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data?.usageMetadata?.candidatesTokenCount ?? 0) + (data?.usageMetadata?.thoughtsTokenCount ?? 0) }
  } catch {
    throw new ProviderError("bad_output", "Gemini's answer wasn't in the expected format. Try again or rephrase.")
  }
}

export async function geminiVerify(key: string) {
  const r = await fetch(`${BASE}/models?pageSize=1`, { headers: { "x-goog-api-key": key } })
  if (!r.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await r.json().catch(() => ({}))
    throw httpError("gemini", r.status, data?.error?.message)
  }
}
