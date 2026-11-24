import { useState, type ReactNode } from "react"

import { analysisById, type AnalysisId } from "./lib/analysis-defs"
import { levelsOf, type Detection } from "./lib/analyses"
import type { Column, Dataset } from "./lib/parse"
import { fmt, summarize } from "./lib/stats"

const KIND_LABEL: Record<string, string> = { number: "Number", category: "Groups", text: "Text / IDs", date: "Date" }

function preview(c: Column) {
  const present = c.values.filter((v) => v !== null)
  if (c.kind === "number") {
    const s = summarize(present as number[])
    return `${fmt(s.min)} – ${fmt(s.max)} · mean ${fmt(s.mean)}`
  }
  if (c.kind === "category") {
    const counts = new Map<string, number>()
    for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return `${top.length} groups: ${top.slice(0, 4).map(([k, n]) => `${k} (${n})`).join(", ")}${top.length > 4 ? "…" : ""}`
  }
  if (c.kind === "date") return `${present[0]} … ${present[present.length - 1]}`
  return `${levelsOf(c).length} unique · e.g. ${present.slice(0, 3).join(", ")}`
}

/** After upload: what's in the file, plus one click to the suggested graph. */
export function DataSummary({ dataset, detections, onGenerate, sheetPicker }: { dataset: Dataset; detections: Detection[]; onGenerate: (id: AnalysisId) => void; sheetPicker: ReactNode }) {
  const best = detections[0]
  const others = detections.slice(1).filter((d) => d.score >= 30).slice(0, 3)
  const bestDef = analysisById(best?.id ?? "")
  return (
    <section className="panel summary">
      <div className="summary-head">
        <div>
          <h2>{dataset.fileName}{dataset.sheetName ? ` — ${dataset.sheetName}` : ""}</h2>
          <span className="dim">{dataset.rowCount} rows · {dataset.columns.length} columns</span>
        </div>
        {sheetPicker}
      </div>
      <div className="col-grid">
        {dataset.columns.map((c) => {
          const missing = c.values.filter((v) => v === null).length
          return (
            <div key={c.name} className="col-card">
              <div className="col-top">
                <strong title={c.name}>{c.name}</strong>
                <span className={`tag tag-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
              </div>
              <span className="col-prev">{preview(c)}</span>
              {missing > 0 && <span className="col-miss">{missing} empty</span>}
            </div>
          )
        })}
      </div>
      {bestDef && (
        <div className="suggest">
          <div>
            <div className="panel-label">Suggested graph</div>
            <strong>{bestDef.label}</strong>
            <div className="dim small">{bestDef.description}</div>
          </div>
          <button type="button" className="primary big" onClick={() => onGenerate(best.id)}>Generate suggested graph</button>
        </div>
      )}
      {others.length > 0 && (
        <div className="row wrap alt-row">
          <span className="dim small">Other good fits:</span>
          {others.map((d) => (
            <button key={d.id} type="button" className="alt-btn" onClick={() => onGenerate(d.id)}>{analysisById(d.id)?.label}</button>
          ))}
        </div>
      )}
    </section>
  )
}

export function DataPreview({ dataset, onRename }: { dataset: Dataset; onRename: (from: string, to: string) => void }) {
  const rows = Math.min(dataset.rowCount, 8)
  const [renaming, setRenaming] = useState(false)
  return (
    <details className="preview" open={renaming || undefined}>
      <summary>
        Data preview · {dataset.rowCount} rows × {dataset.columns.length} columns ·{" "}
        {dataset.columns.slice(0, 14).map((c) => (
          <span key={c.name} className={`tag tag-${c.kind}`}>
            {c.name}: {c.kind}
          </span>
        ))}
        {dataset.columns.length > 14 && <span className="tag">+{dataset.columns.length - 14} more</span>}
      </summary>
      <div className="preview-head">
        <span className="dim">{renaming ? "Type a new name, then press Enter or click away. Esc cancels." : "Column names show up on axes, legends and tables."}</span>
        <button type="button" aria-pressed={renaming} onClick={() => setRenaming((v) => !v)}>
          {renaming ? "Done" : "Rename columns"}
        </button>
      </div>
      <div className="stats-scroll">
        <table>
          <thead>
            <tr>
              {dataset.columns.map((c) => (
                <th key={c.name}>
                  {renaming ? (
                    <input
                      className="col-name"
                      defaultValue={c.name}
                      aria-label={`Rename column ${c.name}`}
                      onBlur={(e) => onRename(c.name, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur()
                        if (e.key === "Escape") {
                          e.currentTarget.value = c.name
                          e.currentTarget.blur()
                        }
                      }}
                    />
                  ) : (
                    c.name
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {dataset.columns.map((c) => (
                  <td key={c.name}>{c.values[r] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
