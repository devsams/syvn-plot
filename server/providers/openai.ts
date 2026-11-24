import { httpError, ProviderError, type ProviderResult } from "../agent"
import { JSON_SCHEMAS, type Prompt, type SchemaId } from "../tasks"

const BASE = "https://api.openai.com/v1"

export async function openaiChat(key: string, model: string, prompt: Prompt, schema: SchemaId): Promise<ProviderResult> {
  const messages = [
    { role: "system", content: prompt.system },
    ...prompt.history.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text.slice(0, 4000) })),
    { role: "user", content: prompt.user },
  ]
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, response_format: { type: "json_schema", json_schema: { name: `benchplot_${schema}`, strict: true, schema: JSON_SCHEMAS[schema] } } }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError("openai", r.status, data?.error?.message)
  const choice = data?.choices?.[0]
  if (choice?.message?.refusal) throw new ProviderError("refused", "OpenAI declined this request. Try rephrasing it.")
  try {
    return { data: JSON.parse(choice?.message?.content ?? ""), inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 }
  } catch {
    throw new ProviderError("bad_output", "OpenAI's answer wasn't in the expected format. Try again or rephrase.")
  }
}

export async function openaiVerify(key: string) {
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })
  if (!r.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await r.json().catch(() => ({}))
    throw httpError("openai", r.status, data?.error?.message)
  }
}
