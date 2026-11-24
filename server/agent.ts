/**
 * The graph-editing agent contract, shared by all providers: the system prompt,
 * the reply schema, and conversion of the reply into A2UI v0.9 messages.
 * The model returns patches with JSON-encoded values (so one schema works for
 * every provider); the server turns them into real updateDataModel /
 * updateComponents messages, and the browser validates them again before use.
 */
import { catalogText } from "../src/lib/analysis-defs"

export const SURFACE_ID = "research-graph"

export type AgentPatch = { kind: "updateDataModel" | "updateComponents"; path: string; valueJson: string; componentsJson: string }
export type AgentReply = { reply: string; patches: AgentPatch[] }
export type ChatTurn = { role: "user" | "model"; text: string }

export const SYSTEM_PROMPT = `You edit a scientific graph in BenchPlot, a GraphPad-Prism-like app for lab researchers.
The graph lives in an A2UI surface "${SURFACE_ID}". Its canonical description is the data-model object /graphSpec:
- analysis: which analysis/graph family (ids below)
- chartType: how groups are drawn — one of the "allowed chart types" given with each request
- xColumn, yColumns (array), groupBy: column names from the uploaded file (exact spelling), or null
- xScale, yScale: "auto" | "linear" | "log"
- title, xLabel, yLabel: text or null (null = automatic)
- filters: array of {column, op: "include"|"exclude"|"min"|"max", values?: [strings], value?: number}
    include = keep only these values; exclude = remove these values; min/max = numeric bounds
- annotations: array of {id, text, fx, fy, size, color, bold} — fx/fy are 0–1 fractions of the canvas (0,0 = top-left)
- palette: color theme name or null. Themes: BenchPlot, Okabe–Ito, Tol muted, Tol high contrast, Classic, Grayscale, Nature (NPG), Science (AAAS), Lancet, NEJM, JAMA, Cell, Tableau 10, Set 1, Dark 2, Paired, Pastel, Viridis, Magma, Cividis, Blues, Reds, Ocean, Sunset, Earth, Control vs treated
- errorBars: "sd" | "sem" | "ci"
- roles / params: advanced per-analysis settings; prefer xColumn / yColumns / groupBy, which are mapped onto roles automatically
- chartEdits: per-chart extras, keyed "0", "1"…: {renames: {"old text": "new text"}, colors: {"g:<group name>" | "s:<series name>": "#hex"}}

Analyses (id: description. Roles):
${catalogText()}

How to answer:
- Return a short plain-language "reply" (1–2 sentences) saying what you changed, or why you couldn't.
- Return "patches": the SMALLEST set of changes. Each patch: kind "updateDataModel", path "/graphSpec/<field>" (e.g. "/graphSpec/yScale"), valueJson = the new value as JSON (e.g. "\\"log\\"", "[\\"Tumor volume (mm3)\\"]", "null"). Set componentsJson to "".
- Only touch /graphSpec. Never send createSurface/deleteSurface, and never rebuild the whole spec unless asked to start over.
- To change graph style (violin/scatter/bar/box/line) set /graphSpec/chartType, only to an allowed chart type; if the style needs a different analysis, also patch /graphSpec/analysis.
- "Filter out X" → append an exclude filter: patch /graphSpec/filters with the full new array (existing filters + the new one).
- Legend / group / series names: use chartEdits renames, e.g. path "/graphSpec/chartEdits/0/renames" with the full renames object.
- Use exact column names and values from the column list. Never invent columns, values or numbers. If the request can't be done with this data, return no patches and explain.
- updateComponents is rarely needed: only to change props of an existing component (ids given), kind "updateComponents", path "", valueJson "", componentsJson = JSON array of {id, component, ...props}.`

/** Converts the model's patches into A2UI v0.9 messages. Undecodable JSON is reported, not guessed. */
export function toA2uiMessages(reply: AgentReply) {
  const messages: Record<string, unknown>[] = []
  const problems: string[] = []
  for (const p of reply.patches ?? []) {
    try {
      if (p.kind === "updateComponents") messages.push({ version: "v0.9", updateComponents: { surfaceId: SURFACE_ID, components: JSON.parse(p.componentsJson) } })
      else messages.push({ version: "v0.9", updateDataModel: { surfaceId: SURFACE_ID, path: p.path, value: JSON.parse(p.valueJson === "" ? "null" : p.valueJson) } })
    } catch {
      problems.push(`The AI sent a value for “${p.path || "components"}” that isn't valid JSON, so it was skipped.`)
    }
  }
  return { messages, problems }
}

export type ProviderResult = { data: unknown; inputTokens: number; outputTokens: number }

/** Errors a provider adapter raises, already in plain language and never containing the key. */
export class ProviderError extends Error {
  code: "invalid_key" | "rate_limited" | "refused" | "provider_error" | "bad_output"
  status: number
  constructor(code: ProviderError["code"], message: string, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const PROVIDER_NAMES = { gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic Claude" } as const
export type ProviderId = keyof typeof PROVIDER_NAMES

export function httpError(provider: ProviderId, status: number, detail?: string): ProviderError {
  const name = PROVIDER_NAMES[provider]
  if (status === 401 || status === 403) return new ProviderError("invalid_key", `${name} rejected this API key. Check that you copied the whole key and that it's active${provider === "gemini" ? " (and that the Generative Language API is enabled for it)" : ""}.`, 401)
  if (status === 429) return new ProviderError("rate_limited", `${name} says you've hit a rate or spending limit on this key. Wait a minute or check your plan's quota.`, 429)
  if (status === 404) return new ProviderError("provider_error", `${name} doesn't recognise the model name. Check the model in API key settings.${detail ? ` (${detail.slice(0, 120)})` : ""}`, 400)
  if (status === 400 && detail && /api key|api_key|apikey/i.test(detail)) return new ProviderError("invalid_key", `${name} rejected this API key. Check that you copied the whole key.`, 401)
  return new ProviderError("provider_error", `${name} returned an error (${status}). Try again in a moment.${detail ? ` Details: ${detail.slice(0, 160)}` : ""}`)
}
