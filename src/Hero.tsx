/**
 * Sentence-style builders (after OpenUI's Sales Dashboard demo): a plain
 * sentence whose key words are clickable chips. Home builds from a sample
 * experiment; after an upload it builds from the file's own columns.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Icon, type IconName } from "./Icon"
import { ANALYSES, analysisById, type AnalysisId } from "./lib/analysis-defs"
import type { Detection, Roles } from "./lib/analyses"
import type { Dataset } from "./lib/parse"
import { SAMPLE_EXPERIMENTS, type SampleExperiment } from "./lib/samples"

export type Tone = "violet" | "rose" | "sky" | "amber" | "green"
type Option = { value: string; label: string; hint?: string; on?: boolean }

/** A pastel chip that opens a stack of options. `multi` keeps the menu open so several can be toggled. */
export function Chip({ tone, icon, label, options, onPick, multi, placeholder = "pick" }: { tone: Tone; icon: IconName; label: string; options: Option[]; onPick: (value: string) => void; multi?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])
  return (
    <span className={`chip-wrap ${open ? "open" : ""}`} ref={ref}>
      <button type="button" className={`chip tone-${tone}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} size={20} />
        <span className="chip-text">{label || placeholder}</span>
      </button>
      {open && (
        <span className={`chip-menu tone-${tone}`} role="listbox" aria-multiselectable={multi || undefined}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={!!o.on}
              className={`chip-opt ${o.on ? "on" : ""}`}
              onClick={() => {
                onPick(o.value)
                if (!multi) setOpen(false)
              }}
            >
              <span>{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

export function BuildButton({ onClick, children = "Build graph", disabled }: { onClick: () => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="build-btn" onClick={onClick} disabled={disabled}>
      {children} <Icon name="arrowRight" size={20} />
    </button>
  )
}

const GROUPS = [...new Set(ANALYSES.map((a) => a.group))]
const groupOf = (e: SampleExperiment) => analysisById(e.analysis)?.group ?? ""
export const UPLOAD = "__upload__"

/** Home: “Show me [kind of analysis] from [sample experiment].” */
export function HomeSentence({ onBuild, onUpload }: { onBuild: (exp: SampleExperiment) => void; onUpload: () => void }) {
  const [group, setGroup] = useState(GROUPS[0])
  const inGroup = useMemo(() => SAMPLE_EXPERIMENTS.filter((e) => groupOf(e) === group), [group])
  const [pick, setPick] = useState<SampleExperiment>(inGroup[0])
  const exp = inGroup.includes(pick) ? pick : inGroup[0]
  return (
    <div className="sentence">
      <span className="word">Show me</span>
      <Chip tone="violet" icon="layers" label={group.toLowerCase()} options={GROUPS.map((g) => ({ value: g, label: g.toLowerCase(), on: g === group }))} onPick={(g) => setGroup(g)} />
      <span className="word">from</span>
      <Chip
        tone="rose"
        icon="flask"
        label={exp.title.toLowerCase()}
        options={[{ value: UPLOAD, label: "my own file…", hint: "CSV or Excel, up to 2 MB" }, ...inGroup.map((e) => ({ value: e.title, label: e.title.toLowerCase(), hint: e.experiment, on: e === exp }))]}
        onPick={(v) => (v === UPLOAD ? onUpload() : setPick(inGroup.find((e) => e.title === v) ?? inGroup[0]))}
      />
      <span className="word">.</span>
      <BuildButton onClick={() => onBuild(exp)} />
    </div>
  )
}

/** How each analysis reads inside the sentence (“Show me … of [column] by [group]”). */
const PHRASE: Record<string, string> = {
  column: "a group comparison", one_factor: "a group comparison", paired: "a before–after comparison", two_way: "a two-factor comparison", summary_bars: "summary bars",
  xy: "an XY graph", time_course: "a time course", dose_response: "a dose–response curve", standard_curve: "a standard curve", kinetics: "enzyme kinetics",
  survival: "survival curves", contingency: "a contingency table", parts: "parts of a whole", histogram: "a histogram", correlation: "a correlation",
  bland_altman: "a Bland–Altman plot", qpcr: "qPCR fold change", plate: "a plate map", volcano: "a volcano plot", pk: "pharmacokinetics", growth: "growth curves",
  melt: "a melt curve", amplification: "qPCR amplification", chromatogram: "chromatogram peaks", matrix_heatmap: "a heatmap", synergy: "drug synergy", pca: "a PCA",
  scatter_groups: "a grouped scatter", ma_plot: "an MA plot", qpcr_standard: "a qPCR standard curve", zprime: "assay quality", waterfall: "a waterfall plot",
  forest: "a forest plot", ranked_bars: "ranked bars",
}
export const phraseFor = (id: string) => PHRASE[id] ?? (analysisById(id)?.label.replace(/\s*\(.*\)$/, "").toLowerCase() ?? id)

const AXIS_ORDER = { y: 0, x: 1, group: 2 } as Record<string, number>
const CONNECTOR = { y: "of", x: "over", group: "by" } as Record<string, string>
const ROLE_TONES: Tone[] = ["sky", "amber", "green"]

/** After an upload: “Show me [analysis] of [measurement] by [group].” Built from the file's own columns. */
export function DataSentence({ dataset, detections, onBuild }: { dataset: Dataset; detections: Detection[]; onBuild: (id: AnalysisId, roles: Roles) => void }) {
  const fitting = detections.filter((d, i) => i === 0 || d.score >= 30)
  const [id, setId] = useState<AnalysisId>(fitting[0]?.id ?? "column")
  const [roles, setRoles] = useState<Roles>(() => fitting[0]?.roles ?? {})
  const def = analysisById(id)
  const choose = (next: AnalysisId) => {
    setId(next)
    setRoles(detections.find((d) => d.id === next)?.roles ?? {})
  }
  if (!def) return null
  const shown = def.roles
    .filter((r) => !r.optional || (roles[r.key] ?? []).length)
    .sort((a, b) => (AXIS_ORDER[a.axis ?? ""] ?? 3) - (AXIS_ORDER[b.axis ?? ""] ?? 3))
    .slice(0, 3)
  const missing = def.roles.some((r) => !r.optional && !(roles[r.key] ?? []).length)
  return (
    <div className="sentence">
      <span className="word">Show me</span>
      <Chip
        tone="violet"
        icon="chart"
        label={phraseFor(id)}
        options={fitting.map((d) => ({ value: d.id, label: analysisById(d.id)?.label ?? d.id, hint: analysisById(d.id)?.group, on: d.id === id }))}
        onPick={(v) => choose(v as AnalysisId)}
      />
      {shown.map((r, i) => {
        const chosen = roles[r.key] ?? []
        const eligible = dataset.columns.filter((c) => r.kinds.includes(c.kind) || (r.kinds.includes("category") && c.kind === "text"))
        const label = chosen.length > 2 ? `${chosen.slice(0, 2).join(", ")} +${chosen.length - 2}` : chosen.join(", ")
        return (
          <span key={r.key} className="sentence-part">
            <span className="word">{i === 0 ? CONNECTOR[r.axis ?? ""] ?? "with" : CONNECTOR[r.axis ?? ""] ?? "and"}</span>
            <Chip
              tone={ROLE_TONES[i % ROLE_TONES.length]}
              icon={r.axis === "group" ? "tag" : r.axis === "x" ? "rows" : "columns"}
              label={label}
              placeholder={r.label.toLowerCase()}
              multi={r.multiple}
              options={eligible.map((c) => ({ value: c.name, label: c.name, on: chosen.includes(c.name) }))}
              onPick={(name) =>
                setRoles((prev) => {
                  const cur = prev[r.key] ?? []
                  const next = r.multiple ? (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]) : [name]
                  return { ...prev, [r.key]: next }
                })
              }
            />
          </span>
        )
      })}
      <span className="word">.</span>
      <BuildButton onClick={() => onBuild(id, roles)} disabled={missing} />
    </div>
  )
}
