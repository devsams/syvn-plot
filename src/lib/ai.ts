/**
 * AI chat client. Every turn sends the current graphSpec plus column metadata
 * (names, types, ranges, levels, a few example rows — never the whole file);
 * the agent answers with A2UI patches that the caller validates before use.
 */
import { byokHeaders, type ByokSettings } from "./byok"
import { levelsOf } from "./analyses"
import { chartTypesFor, type GraphSpec } from "./graphSpec"
import type { Dataset } from "./parse"
import { summarize } from "./stats"

export function describeDataset(dataset: Dataset) {
  return {
    file: dataset.sheetName ? `${dataset.fileName} (sheet ${dataset.sheetName})` : dataset.fileName,
    rows: dataset.rowCount,
    columns: dataset.columns.map((c) => {
      const present = c.values.filter((v) => v !== null)
      if (c.kind === "number") {
        const s = summarize(present as number[])
        return { name: c.name, kind: c.kind, count: s.n, missing: c.values.length - s.n, min: s.min, max: s.max, mean: Number(s.mean.toPrecision(4)) }
      }
      if (c.kind === "category") return { name: c.name, kind: c.kind, count: present.length, levels: levelsOf(c).slice(0, 40) }
      return { name: c.name, kind: c.kind, count: present.length, examples: present.slice(0, 4) }
    }),
    exampleRows: Array.from({ length: Math.min(5, dataset.rowCount) }, (_, r) => Object.fromEntries(dataset.columns.map((c) => [c.name, c.values[r]]))),
  }
}

export type AgentResponse = {
  reply: string
  messages: Record<string, unknown>[]
  problems: string[]
  usage?: { provider: string; model: string; inputTokens: number; outputTokens: number; mode: string }
  quota?: { used: number; limit: number } | null
}

export class AgentError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function askAgent(args: { question: string; dataset: Dataset; spec: GraphSpec; components: { id: string; component: string }[]; history: { role: "user" | "model"; text: string }[]; byok: ByokSettings }): Promise<AgentResponse> {
  let res: Response
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...byokHeaders(args.byok) },
      body: JSON.stringify({ question: args.question, dataset: describeDataset(args.dataset), graphSpec: args.spec, chartTypes: chartTypesFor(args.spec.analysis), components: args.components, history: args.history.slice(-8) }),
    })
  } catch {
    throw new AgentError("network", "Couldn't reach the BenchPlot server. Is it still running?")
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new AgentError(body.code ?? "error", body.error ?? `The AI request failed (${res.status}).`)
  return body as AgentResponse
}

export async function verifyKey(byok: ByokSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/verify-key", { method: "POST", headers: byokHeaders(byok) })
    const body = await res.json()
    return { ok: !!body.ok, message: body.ok ? body.message : body.error }
  } catch {
    return { ok: false, message: "Couldn't reach the BenchPlot server to check the key." }
  }
}

export async function aiStatus(): Promise<{ serverKeys: Record<string, boolean>; quota: { used: number; limit: number } } | null> {
  try {
    return await (await fetch("/api/ai-status")).json()
  } catch {
    return null
  }
}

export type AiTaskId = "edit" | "advise" | "summarize" | "polish" | "cleanup"
export type TaskResponse = AgentResponse & { legend?: string; methods?: string; ops?: { op: string; column: string; args: Record<string, unknown> }[] }

/** One AI task call. The payload is task-specific; the key travels in headers only. */
export async function askAi(task: AiTaskId, byok: ByokSettings, payload: Record<string, unknown>): Promise<TaskResponse> {
  let res: Response
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...byokHeaders(byok) }, body: JSON.stringify({ task, ...payload }) })
  } catch {
    throw new AgentError("network", "Couldn't reach the BenchPlot server. Is it still running?")
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new AgentError(body.code ?? "error", body.error ?? `The AI request failed (${res.status}).`)
  return body as TaskResponse
}
