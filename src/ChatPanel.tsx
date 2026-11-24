import { useEffect, useMemo, useRef, useState } from "react"

import { validateAgentMessages, type ComponentOverride } from "./lib/a2uiValidate"
import { AgentError, askAi, describeDataset, type AiTaskId, type TaskResponse } from "./lib/ai"
import { levelsOf, type Result } from "./lib/analyses"
import { providerName, type ByokSettings } from "./lib/byok"
import { applyCleanup, cleanupSample, type CleanupResult } from "./lib/cleanup"
import type { FigureText } from "./lib/figureText"
import { chartTypesFor, type GraphSpec } from "./lib/graphSpec"
import type { Dataset } from "./lib/parse"
import type { ChartSpec } from "./lib/specs"
import { statsForSummary, unverifiedNumbers } from "./lib/summaryCheck"

type Usage = TaskResponse["usage"]
type Turn =
  | { kind: "user"; text: string }
  | { kind: "edit"; reply: string; changes: string[]; problems: string[]; applied: boolean; before: GraphSpec; usage?: Usage; undone?: boolean }
  | { kind: "advise"; reply: string; proposal: { spec: GraphSpec; changes: string[]; messages: Record<string, unknown>[] } | null; problems: string[]; applied?: boolean; before?: GraphSpec; usage?: Usage; undone?: boolean }
  | { kind: "summary"; text: string; unverified: string[]; usage?: Usage }
  | { kind: "polish"; reply: string; legend: string; methods: string; unverified: string[]; applied?: boolean; before?: GraphSpec; usage?: Usage }
  | { kind: "consent" }
  | { kind: "cleanup"; reply: string; result: CleanupResult | null; problems: string[]; applied?: boolean; undone?: boolean; usage?: Usage }
  | { kind: "error"; text: string; code: string }

export type Computed = { result: Result; charts: ChartSpec[]; figureText: FigureText } | null

type Props = {
  dataset: Dataset
  spec: GraphSpec
  computed: Computed
  components: { id: string; component: string }[]
  byok: ByokSettings
  available: boolean
  quotaNote: string
  requested: AiTaskId | null
  onRequestHandled: () => void
  onApply: (spec: GraphSpec, messages: Record<string, unknown>[], overrides: ComponentOverride[]) => void
  onUndo: (spec: GraphSpec) => void
  onCleanupApply: (ds: Dataset) => void
  onCleanupUndo: () => void
  onOpenKey: () => void
}

const ACTIONS: { task: AiTaskId; label: string; hint: string }[] = [
  { task: "summarize", label: "📝 Summarize results", hint: "A results paragraph using only the computed statistics" },
  { task: "advise", label: "🧭 Which test should I use?", hint: "Recommends an analysis for this data and explains why" },
  { task: "cleanup", label: "🧹 Clean up my data", hint: "Proposes fixes for messy group names, units, summary rows…" },
  { task: "polish", label: "✨ Polish legend", hint: "Rewrites the legend and methods for a journal, keeping every number" },
]

/**
 * The optional AI assistant. Without a key it's a short card saying what a key adds;
 * with a key it edits the graph by request and runs the four quick actions. AI is only
 * called when the person clicks; every result is validated before it changes anything.
 */
export function ChatPanel(props: Props) {
  const { dataset, spec, computed, components, byok, available, quotaNote, requested, onRequestHandled, onApply, onUndo, onCleanupApply, onCleanupUndo, onOpenKey } = props
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<"edit" | "advise">("edit")
  const [consented, setConsented] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const source = `${dataset.fileName}|${dataset.sheetName ?? ""}`
  useEffect(() => {
    setTurns([])
    setMode("edit")
  }, [source])
  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [turns])

  const push = (t: Turn) => setTurns((prev) => [...prev, t])
  const patchTurn = (i: number, patch: Partial<Turn>) => setTurns((prev) => prev.map((x, k) => (k === i ? ({ ...x, ...patch } as Turn) : x)))
  const history = () => turns.flatMap((t): { role: "user" | "model"; text: string }[] => (t.kind === "user" ? [{ role: "user", text: t.text }] : t.kind === "edit" || t.kind === "advise" ? [{ role: "model", text: t.reply }] : []))
  const fail = (e: unknown) => {
    const err = e instanceof AgentError ? e : new AgentError("error", String(e))
    push({ kind: "error", text: err.message, code: err.code })
  }

  const base = () => ({ dataset: describeDataset(dataset), graphSpec: spec })

  const runEdit = async (q: string) => {
    const before = spec
    const res = await askAi("edit", byok, { ...base(), question: q, chartTypes: chartTypesFor(spec.analysis), components, history: history() })
    const check = validateAgentMessages(res.messages ?? [], { spec, ds: dataset, components })
    const problems = [...(res.problems ?? []), ...check.problems]
    const applied = check.ok && (res.messages ?? []).length > 0 && !(res.problems ?? []).length
    if (applied) onApply(check.spec, res.messages, check.overrides)
    push({ kind: "edit", reply: res.reply, changes: check.changes, problems, applied, before, usage: res.usage })
  }

  const runAdvise = async (q: string) => {
    const res = await askAi("advise", byok, { ...base(), question: q, history: history() })
    let proposal: Extract<Turn, { kind: "advise" }>["proposal"] = null
    let problems = res.problems ?? []
    if ((res.messages ?? []).length) {
      const check = validateAgentMessages(res.messages, { spec, ds: dataset, components })
      if (check.ok) proposal = { spec: check.spec, changes: check.changes, messages: res.messages }
      else problems = [...problems, ...check.problems]
    }
    push({ kind: "advise", reply: res.reply, proposal, problems, usage: res.usage })
    setMode(proposal ? "edit" : "advise")
  }

  const runSummary = async (q = "") => {
    if (!computed) return
    const stats = statsForSummary(computed.result, computed.charts)
    const res = await askAi("summarize", byok, { ...base(), question: q, stats, figureText: computed.figureText })
    push({ kind: "summary", text: res.reply, unverified: unverifiedNumbers(res.reply, { stats, legend: computed.figureText.legend }), usage: res.usage })
  }

  const runPolish = async (style = "") => {
    if (!computed) return
    const res = await askAi("polish", byok, { ...base(), question: style, figureText: computed.figureText })
    const source = [computed.figureText.legend, computed.figureText.methods]
    push({ kind: "polish", reply: res.reply, legend: res.legend ?? "", methods: res.methods ?? "", unverified: unverifiedNumbers(`${res.legend} ${res.methods}`, source), usage: res.usage })
  }

  const runCleanup = async (q = "") => {
    const sample = cleanupSample(dataset)
    const res = await askAi("cleanup", byok, { dataset: { file: dataset.fileName, rows: dataset.rowCount, columns: sample.columns }, sample: sample.sample, question: q })
    const ops = res.ops ?? []
    push({ kind: "cleanup", reply: res.reply, result: ops.length ? applyCleanup(dataset, ops) : null, problems: res.problems ?? [], usage: res.usage })
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const action = (task: AiTaskId) => {
    if (!available) return onOpenKey()
    if (task === "summarize") void run("Writing the summary…", () => runSummary())
    if (task === "polish") void run("Polishing the text…", () => runPolish())
    if (task === "advise") {
      push({ kind: "user", text: "Which test should I use for this data?" })
      void run("Thinking about your design…", () => runAdvise("Which test should I use for this data?"))
    }
    if (task === "cleanup") {
      if (consented) void run("Looking for problems in the data…", () => runCleanup())
      else push({ kind: "consent" })
    }
  }

  // Actions requested from inside the graph (e.g. "Polish with AI" under the legend).
  useEffect(() => {
    if (!requested) return
    onRequestHandled()
    action(requested)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  const send = (q: string) => {
    const text = q.trim()
    if (!text || busy) return
    push({ kind: "user", text })
    setInput("")
    void run(mode === "advise" ? "Thinking about your design…" : "Working on it…", () => (mode === "advise" ? runAdvise(text) : runEdit(text)))
  }

  const suggestions = useMemo(() => {
    const out: string[] = []
    if (spec.yScale !== "log") out.push("Make the y-axis log scale")
    const g = spec.groupBy ? dataset.columns.find((c) => c.name === spec.groupBy) : undefined
    const lv = g ? levelsOf(g) : []
    if (lv.length > 2) out.push(`Filter out ${lv[lv.length - 1]}`)
    const other = chartTypesFor(spec.analysis).find((t) => t !== spec.chartType && t !== "auto")
    if (other) out.push(`Change to a ${other === "scatter" ? "scatter dot" : other} plot`)
    return out.slice(0, 3)
  }, [spec, dataset])

  if (!available) {
    return (
      <section className="chat assistant-off">
        <div className="chat-head">
          <strong>AI assistant</strong>
          <span className="tag">optional</span>
        </div>
        <p className="small">Everything on this page works without AI. Add your own API key (Gemini, OpenAI or Claude) to also:</p>
        <ul className="small unlock">
          <li><strong>Edit by asking</strong> — “log scale, drop Vehicle, violin plot”</li>
          <li><strong>Get a test recommendation</strong> with the reasoning</li>
          <li><strong>Clean up messy data</strong> — you approve every change</li>
          <li><strong>Write a results summary</strong> — numbers checked against the statistics</li>
          <li><strong>Polish the legend</strong> for a journal</li>
        </ul>
        <button type="button" className="primary" onClick={onOpenKey}>Add API key</button>
        <p className="dim small">Your key stays in your browser. AI is only used when you click.</p>
      </section>
    )
  }

  return (
    <section className="chat">
      <div className="chat-head">
        <strong>AI assistant</strong>
        <button type="button" className="key-badge" onClick={onOpenKey} title="API key settings">
          {byok.key ? `🔑 ${providerName(byok.provider)} · your key` : `🔑 ${quotaNote}`}
        </button>
      </div>
      <div className="ai-actions">
        {ACTIONS.map((a) => (
          <button key={a.task} type="button" onClick={() => action(a.task)} disabled={!!busy || ((a.task === "summarize" || a.task === "polish") && !computed)} title={a.hint}>
            {a.label}
          </button>
        ))}
      </div>

      {turns.map((t, i) => {
        if (t.kind === "user") return <div key={i} className="bubble bubble-user">{t.text}</div>
        if (t.kind === "error")
          return (
            <div key={i} className="problem">
              {t.text}
              {(t.code === "invalid_key" || t.code === "no_key" || t.code === "quota") && (
                <div>
                  <button type="button" className="link-btn" onClick={onOpenKey}>Open API key settings</button>
                </div>
              )}
            </div>
          )
        if (t.kind === "consent")
          return (
            <div key={i} className="bubble bubble-ai">
              <div><strong>Before I look at your data:</strong> cleanup needs to see a sample. This sends the column names, the values in each column and the first 15 + last 5 rows to {providerName(byok.provider)}. Nothing is changed until you approve.</div>
              <div className="turn-actions">
                <button type="button" className="primary" onClick={() => { setConsented(true); patchTurn(i, { kind: "user", text: "Clean up my data (sample shared)" } as Turn); void run("Looking for problems in the data…", () => runCleanup()) }}>Send sample &amp; continue</button>
                <button type="button" onClick={() => setTurns((prev) => prev.filter((_, k) => k !== i))}>Cancel</button>
              </div>
            </div>
          )
        return (
          <div key={i} className="bubble bubble-ai">
            {t.kind === "edit" && (
              <>
                <div>{t.reply}</div>
                {t.applied && t.changes.length > 0 && <ul className="changes">{t.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
                {t.problems.length > 0 && <div className="problem small"><strong>Not applied — </strong>{t.problems.join(" ")}</div>}
                <div className="turn-foot">
                  {t.applied && !t.undone && <button type="button" className="link-btn" onClick={() => { onUndo(t.before); patchTurn(i, { undone: true }) }}>Undo</button>}
                  {t.undone && <span className="dim">Undone</span>}
                  <UsageNote usage={t.usage} />
                </div>
              </>
            )}
            {t.kind === "advise" && (
              <>
                <div className="pre-wrap">{t.reply}</div>
                {t.proposal && !t.applied && (
                  <div className="proposal">
                    <ul className="changes">{t.proposal.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                    <button type="button" className="primary" onClick={() => { const before = spec; onApply(t.proposal!.spec, t.proposal!.messages, []); patchTurn(i, { applied: true, before }) }}>Apply recommendation</button>
                  </div>
                )}
                {t.problems.length > 0 && <div className="problem small"><strong>Couldn't apply the suggestion — </strong>{t.problems.join(" ")}</div>}
                <div className="turn-foot">
                  {t.applied && !t.undone && <button type="button" className="link-btn" onClick={() => { if (t.before) onUndo(t.before); patchTurn(i, { undone: true }) }}>Undo</button>}
                  {t.undone && <span className="dim">Undone</span>}
                  <UsageNote usage={t.usage} />
                </div>
              </>
            )}
            {t.kind === "summary" && (
              <>
                <div className="panel-label">Results summary</div>
                <p className="summary-text">{t.text}</p>
                <Verified unverified={t.unverified} what="statistics" />
                <div className="turn-foot">
                  <CopyButton text={t.text} />
                  <UsageNote usage={t.usage} />
                </div>
              </>
            )}
            {t.kind === "polish" && (
              <>
                <div className="panel-label">Polished legend</div>
                <p className="summary-text">{t.legend}</p>
                <div className="panel-label">Polished methods</div>
                <p className="summary-text">{t.methods}</p>
                <Verified unverified={t.unverified} what="original text" />
                <div className="turn-foot">
                  {!t.applied ? (
                    <button type="button" className="primary" onClick={() => { const before = spec; onApply({ ...spec, figureText: { legend: t.legend, methods: t.methods } }, [], []); patchTurn(i, { applied: true, before }) }}>Use this text</button>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => { if (t.before) onUndo(t.before); patchTurn(i, { applied: false }) }}>Undo</button>
                  )}
                  <UsageNote usage={t.usage} />
                </div>
              </>
            )}
            {t.kind === "cleanup" && (
              <>
                <div className="pre-wrap">{t.reply}</div>
                {t.result && t.result.steps.length > 0 && (
                  <div className="proposal">
                    <div className="panel-label">Proposed changes (preview)</div>
                    <ul className="changes">{t.result.steps.map((s) => <li key={s}>{s}</li>)}</ul>
                    <div className="dim small">
                      {t.result.before.rows} → {t.result.after.rows} rows · {t.result.before.cols} → {t.result.after.cols} columns
                    </div>
                    {!t.applied && !t.undone && <button type="button" className="primary" onClick={() => { onCleanupApply(t.result!.dataset); patchTurn(i, { applied: true }) }}>Apply cleanup</button>}
                  </div>
                )}
                {[...t.problems, ...(t.result?.problems ?? [])].length > 0 && <div className="problem small">{[...t.problems, ...(t.result?.problems ?? [])].join(" ")}</div>}
                <div className="turn-foot">
                  {t.applied && !t.undone && <button type="button" className="link-btn" onClick={() => { onCleanupUndo(); patchTurn(i, { undone: true }) }}>Undo cleanup</button>}
                  {t.undone && <span className="dim">Undone — original data restored</span>}
                  <UsageNote usage={t.usage} />
                </div>
              </>
            )}
          </div>
        )
      })}
      {busy && <div className="bubble bubble-ai thinking">{busy}</div>}
      <div ref={endRef} />

      {turns.length === 0 && (
        <div className="samples">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setInput(s)}>{s}</button>
          ))}
        </div>
      )}

      {mode === "advise" && (
        <div className="mode-note small">
          Answering the test advisor · <button type="button" className="link-btn" onClick={() => setMode("edit")}>back to editing</button>
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === "advise" ? "Answer the advisor's question…" : "e.g. log scale, filter out Vehicle, violin plot"} disabled={!!busy} />
        <button type="submit" disabled={!!busy || !input.trim()}>{mode === "advise" ? "Reply" : "Ask"}</button>
      </form>
    </section>
  )
}

function UsageNote({ usage }: { usage?: Usage }) {
  if (!usage) return <span />
  return <span className="usage">{usage.model} · {usage.inputTokens} in / {usage.outputTokens} out · {usage.mode}</span>
}

function Verified({ unverified, what }: { unverified: string[]; what: string }) {
  return unverified.length ? (
    <div className="problem small">⚠ These numbers don't match the {what}: {unverified.join(", ")}. Check them before using this text.</div>
  ) : (
    <div className="ok-msg small">✓ Every number matches the {what}.</div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="link-btn" onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? "Copied" : "Copy"}
    </button>
  )
}
