import { useEffect, useRef, useState } from "react"

import { DownloadMenu } from "../ChartCard"
import type { ChartType, Filter } from "../lib/graphSpec"
import type { ChartSpec } from "../lib/specs"
import { useAiActions, useGraphControl } from "./context"

const TYPE_LABEL: Record<string, string> = { auto: "Automatic", bar: "Bar + dots", scatter: "Scatter / dot plot", box: "Box & whiskers", violin: "Violin", line: "Line" }

export function ChartTypeView({ value, options, errorBars, showErrorBars }: { value: ChartType; options: ChartType[]; errorBars: string; showErrorBars: boolean }) {
  const api = useGraphControl()
  return (
    <div className="ctl">
      {options.length > 1 && (
        <label className="ctl-field">
          <span>Graph</span>
          <select value={value} onChange={(e) => api?.patch("/graphSpec/chartType", e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>{TYPE_LABEL[o] ?? o}</option>
            ))}
          </select>
        </label>
      )}
      {showErrorBars && (
        <label className="ctl-field">
          <span>Error bars</span>
          <select value={errorBars} onChange={(e) => api?.patch("/graphSpec/errorBars", e.target.value)}>
            <option value="sd">SD</option>
            <option value="sem">SEM</option>
            <option value="ci">95% CI</option>
          </select>
        </label>
      )}
    </div>
  )
}

export function ScaleView({ axis, value }: { axis: "x" | "y"; value: string }) {
  const api = useGraphControl()
  return (
    <label className="ctl-field">
      <span>{axis.toUpperCase()} scale</span>
      <select value={value} onChange={(e) => api?.patch(`/graphSpec/${axis}Scale`, e.target.value)}>
        <option value="auto">Auto</option>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select>
    </label>
  )
}

type FilterColumn = { name: string; kind: string; levels?: string[]; min?: number; max?: number }

const describeFilter = (f: Filter) =>
  f.op === "include" ? `${f.column}: only ${f.values?.join(", ")}` : f.op === "exclude" ? `${f.column}: without ${f.values?.join(", ")}` : `${f.column} ${f.op === "min" ? "≥" : "≤"} ${f.value}`

export function FilterView({ filters, columns }: { filters: Filter[]; columns: FilterColumn[] }) {
  const api = useGraphControl()
  const [open, setOpen] = useState(false)
  const [col, setCol] = useState<string>("")
  const [mode, setMode] = useState<"exclude" | "include" | "range">("exclude")
  const [picked, setPicked] = useState<string[]>([])
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const c = columns.find((x) => x.name === col)
  const usable = columns.filter((x) => (x.levels && x.levels.length <= 60 && x.levels.length > 1) || x.kind === "number")

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [open])

  const pickColumn = (name: string) => {
    const next = columns.find((x) => x.name === name)
    setCol(name)
    setPicked([])
    setMode(next?.kind === "number" ? "range" : "exclude")
    setMin(next?.min !== undefined ? String(next.min) : "")
    setMax(next?.max !== undefined ? String(next.max) : "")
  }

  const add = () => {
    if (!c) return
    const added: Filter[] = []
    if (mode === "range") {
      if (min !== "" && Number(min) !== c.min) added.push({ column: c.name, op: "min", value: Number(min) })
      if (max !== "" && Number(max) !== c.max) added.push({ column: c.name, op: "max", value: Number(max) })
    } else if (picked.length) added.push({ column: c.name, op: mode, values: picked })
    if (added.length) api?.patch("/graphSpec/filters", [...filters, ...added])
    setOpen(false)
    setCol("")
  }

  return (
    <div className="ctl filter-ctl" ref={ref}>
      <span className="ctl-label">Filters</span>
      {filters.map((f, i) => (
        <span key={i} className="filter-chip">
          {describeFilter(f)}
          <button type="button" aria-label="Remove filter" onClick={() => api?.patch("/graphSpec/filters", filters.filter((_, k) => k !== i))}>✕</button>
        </span>
      ))}
      <span className="popover-anchor">
        <button type="button" className="ctl-btn" onClick={() => setOpen((v) => !v)}>+ Filter</button>
        {open && (
          <div className="filter-pop">
            <label className="ctl-field">
              <span>Column</span>
              <select value={col} onChange={(e) => pickColumn(e.target.value)}>
                <option value="">— pick a column —</option>
                {usable.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            {c && c.kind !== "number" && (
              <>
                <div className="seg small">
                  <button type="button" aria-pressed={mode === "exclude"} onClick={() => setMode("exclude")}>Leave out</button>
                  <button type="button" aria-pressed={mode === "include"} onClick={() => setMode("include")}>Keep only</button>
                </div>
                <div className="level-list">
                  {(c.levels ?? []).map((l) => (
                    <label key={l}>
                      <input type="checkbox" checked={picked.includes(l)} onChange={() => setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]))} />
                      {l}
                    </label>
                  ))}
                </div>
              </>
            )}
            {c && c.kind === "number" && (
              <div className="row">
                <label className="ctl-field">
                  <span>Min</span>
                  <input type="number" value={min} onChange={(e) => setMin(e.target.value)} />
                </label>
                <label className="ctl-field">
                  <span>Max</span>
                  <input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
                </label>
              </div>
            )}
            <div className="row">
              <button type="button" className="primary" disabled={!c} onClick={add}>Apply filter</button>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      </span>
    </div>
  )
}

export function ExportView({ chart }: { chart: ChartSpec | undefined }) {
  const [open, setOpen] = useState(false)
  if (!chart) return null
  return (
    <span className="popover-anchor export-ctl">
      <button type="button" className="ctl-btn primary" onClick={() => setOpen((v) => !v)}>Export graph</button>
      {open && <DownloadMenu spec={chart} initialPreset="single" onClose={() => setOpen(false)} />}
    </span>
  )
}

/** Figure legend + statistical methods, generated from the graph (free). With an AI key, "Polish" rewrites them. */
export function FigureTextView({ legend, methods, edited }: { legend: string; methods: string; edited: boolean }) {
  const ai = useAiActions()
  const control = useGraphControl()
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }
  if (!legend && !methods) return null
  return (
    <div className="figure-text">
      <div className="stats-head">
        <span className="chart-title">Figure legend &amp; methods</span>
        <span className="chart-actions">
          {edited && <button type="button" onClick={() => control?.patch("/graphSpec/figureText", null)}>Back to generated text</button>}
          {ai?.available && <button type="button" onClick={() => ai.run("polish")}>✨ Polish with AI</button>}
          <button type="button" onClick={() => copy("both", `${legend}\n\n${methods}`)}>{copied === "both" ? "Copied" : "Copy both"}</button>
        </span>
      </div>
      <div className="ft-block">
        <div className="ft-label">
          Legend <button type="button" className="link-btn" onClick={() => copy("legend", legend)}>{copied === "legend" ? "copied" : "copy"}</button>
        </div>
        <p>{legend}</p>
      </div>
      <div className="ft-block">
        <div className="ft-label">
          Statistical methods <button type="button" className="link-btn" onClick={() => copy("methods", methods)}>{copied === "methods" ? "copied" : "copy"}</button>
        </div>
        <p>{methods}</p>
      </div>
      <p className="dim small">{edited ? "AI-polished text you accepted — numbers were checked against the original. " : "Written automatically from the graph settings and the computed statistics. "}Check it against your study design before publishing.</p>
    </div>
  )
}
