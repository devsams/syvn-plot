/** Shared helpers for analysis runners: column lookup, name patterns, tables, group comparison. */
import type { ColumnKindName } from "./analysis-defs"
import { numbersOf, type Column, type Dataset } from "./parse"
import type { ChartSpec, ColumnStyle, ErrorKind, Group, TableSpec } from "./specs"
import { fmtP, holmSidak, oneWayAnova, summarize, welchT, type Comparison, type TestResult } from "./stats"

export type Roles = Record<string, string[]>
export type Params = Record<string, string>
export type RunOptions = { style: ColumnStyle; error: ErrorKind }
export type Result = { headline: string; charts: ChartSpec[]; tables: TableSpec[] }

// --- name patterns ---------------------------------------------------------
export const RE = {
  time: /(^|[\s_(])(time|times|day|days|hour|hours|hr|hrs|h|min|mins|minutes?|sec|week|weeks|month|months|year|years|duration|follow.?up|survival|os|pfs|t)([\s_)]|$)/i,
  event: /event|status|dead|death|died|censor|outcome|relapse|progress/i,
  dose: /dose|conc|concentration|\[|µm|\bum\b|\bnm\b|\bmm\b|\bpm\b|mg\/kg|ug\/ml|µg|ng\/ml|\blog\b|log10|log\s*[([]/i,
  signal: /\bod\b|od\d|abs|absorbance|signal|fluor|\brfu\b|\brlu\b|lum|cpm|a450|a562|a595|a280|intensity|reading/i,
  standardWord: /^(std|standard|s\d|cal|blank|unk|unknown|sample)/i,
  substrate: /substrate|\[s\]|^s$|^s\s|\bs\s*\(/i,
  velocity: /velocity|rate|\bv0?\b|activity/i,
  fc: /log2|logfc|log fc|fold.?change|\bfc\b/i,
  p: /p.?val|padj|adj.?p|fdr|q.?val|^p$|p\s*\(|pvalue/i,
  ct: /(^|[\s_])(ct|cq|cp)([\s_]|$)|ct.?value|threshold cycle/i,
  well: /^well/i,
  mean: /^(mean|average|avg)/i,
  err: /^(sd|sem|se|stdev|std|s\.d|s\.e|error)/i,
  n: /^(n|count|num)$/i,
  paired: /\b(pre|post|before|after|baseline|follow.?up|visit|week|day|month|t\d|time ?\d)\b/i,
  subject: /subject|patient|participant|mouse|animal|donor|id$|^id/i,
  method: /method|assay|device|instrument|reader|observer|rater|kit/i,
  percent: /percent|%|fraction|proportion|share|count|number|amount|composition/i,
  refGene: /^(gapdh|actb|b-?actin|β-?actin|18s|rn18s|b2m|hprt1?|rplp0|tbp|ppia|ubc|ywhaz|rpl13a|sdha|gusb|ef1a|eef1a1|tubulin|tuba1a)$/i,
  control: /^(control|ctrl|vehicle|veh|untreated|wt|wild.?type|mock|dmso|pbs|naive|scr|scramble|sictrl|sicontrol|nt|non.?targeting|baseline|day ?0|0 ?h)$/i,
}

export const cols = (ds: Dataset, kinds: ColumnKindName[]) => ds.columns.filter((c) => kinds.includes(c.kind))
export const byName = (ds: Dataset, name?: string) => (name ? ds.columns.find((c) => c.name === name) : undefined)
export const role = (ds: Dataset, roles: Roles, key: string) => byName(ds, roles[key]?.[0])
export const roleAll = (ds: Dataset, roles: Roles, key: string) => (roles[key] ?? []).map((n) => byName(ds, n)).filter((c): c is Column => !!c)
export const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
export const levelsOf = (c: Column) => [...new Set(c.values.map(str).filter((v): v is string => v !== null))]
export const isMonotonic = (c: Column) => {
  const v = numbersOf(c)
  return v.length >= 3 && v.length >= c.values.length * 0.9 && v.every((x, i) => i === 0 || x > v[i - 1])
}
export const isInteger = (c: Column) => numbersOf(c).every((v) => Number.isInteger(v) && v >= 0)
export const names = (c: Column[]) => c.map((x) => x.name)

export function errHalf(values: number[], kind: ErrorKind) {
  const s = summarize(values)
  if (s.n < 2) return 0
  return kind === "sem" ? s.sem : kind === "ci" ? s.ciHigh - s.mean : s.sd
}
export const errLabel = (k: ErrorKind) => (k === "ci" ? "95% CI" : k.toUpperCase())

/** Columns whose names differ only by a trailing replicate number become one series. */
export function replicateSets(columns: Column[]) {
  const base = (n: string) => n.replace(/[\s_.-]*(rep(licate)?|r|#|n)?[\s_.-]*\d+$/i, "").trim()
  const map = new Map<string, Column[]>()
  for (const c of columns) {
    // Plate wells (A1, B12…) are separate samples, not replicates of "A".
    const b = /^[A-Pa-p]\d{1,2}$/.test(c.name.trim()) ? c.name : base(c.name) || c.name
    map.set(b, [...(map.get(b) ?? []), c])
  }
  return [...map.entries()].flatMap(([b, cs]) => (cs.length > 1 ? [{ name: b, cols: cs }] : cs.map((c) => ({ name: c.name, cols: [c] }))))
}

// --- tables ------------------------------------------------------------------

export const DESCRIPTIVE: [string, (s: ReturnType<typeof summarize>) => number][] = [
  ["Number of values", (s) => s.n],
  ["Mean", (s) => s.mean],
  ["Std. deviation", (s) => s.sd],
  ["Std. error of mean", (s) => s.sem],
  ["Lower 95% CI of mean", (s) => s.ciLow],
  ["Upper 95% CI of mean", (s) => s.ciHigh],
  ["Minimum", (s) => s.min],
  ["25% percentile", (s) => s.q1],
  ["Median", (s) => s.median],
  ["75% percentile", (s) => s.q3],
  ["Maximum", (s) => s.max],
  ["Coefficient of variation (%)", (s) => (s.mean !== 0 && s.n > 1 ? (100 * s.sd) / Math.abs(s.mean) : NaN)],
]

export function descriptiveTable(title: string, groups: Group[]): TableSpec {
  const stats = groups.map((g) => summarize(g.values))
  return { title, columns: ["", ...groups.map((g) => g.name)], rows: DESCRIPTIVE.map(([label, get]) => [label, ...stats.map((s) => (s.n ? get(s) : null))]) }
}

export const testsTable = (title: string, tests: (TestResult | null)[]): TableSpec => ({
  title,
  columns: ["Test", "Statistic", "P value", "Summary"],
  rows: tests.filter((t): t is TestResult => !!t).map((t) => [t.name, t.statistic, fmtP(t.p), t.summary]),
})

export const comparisonsTable = (title: string, groups: Group[], comps: Comparison[]): TableSpec => ({
  title,
  columns: ["Comparison", "Mean diff.", "Adjusted P", "Summary"],
  rows: comps.map((c) => [`${groups[c.a].name} vs. ${groups[c.b].name}`, -c.diff, fmtP(c.p), c.summary]),
})

/** Column graph + test + tables for a set of groups. */
export function compareGroups(title: string, yLabel: string, groups: Group[], opts: RunOptions, out: Result) {
  const filled = groups.filter((g) => g.values.length > 0)
  const test = filled.length === 2 ? welchT(filled[0].values, filled[1].values) : filled.length > 2 ? oneWayAnova(filled.map((g) => g.values)) : null
  const comparisons = filled.length > 2 ? holmSidak(groups.map((g) => g.values)) : []
  out.charts.push({ kind: "column", title, yLabel, style: opts.style, error: opts.error, groups, test, comparisons })
  out.tables.push(descriptiveTable(`${title} — descriptive statistics`, groups))
  if (test) out.tables.push(testsTable(`${title} — test`, [test]))
  if (comparisons.length) out.tables.push(comparisonsTable(`${title} — Holm–Šídák multiple comparisons`, groups, comparisons))
}


export const PALETTE_FOR = (i: number) => ["#2f6fdb", "#e0533d", "#2a9d6f", "#8a5cd1", "#e39b22", "#1fa3b5", "#c94c8a", "#6b7a1f", "#7a4a2a", "#4a5568", "#d1495b", "#3d8bd9"][((i % 12) + 12) % 12]

export const need = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg)
}

/** % of control or fold of control, using the control group's mean. */
export function normalizeGroups(groups: Group[], mode: string | undefined, control: string | undefined) {
  if (!mode || mode === "none") return { groups, label: "" }
  const ref = groups.find((g) => g.name === control) ?? groups[0]
  const m = ref && ref.values.length ? ref.values.reduce((s, v) => s + v, 0) / ref.values.length : NaN
  need(Number.isFinite(m) && m !== 0, `Control “${ref?.name}” has no usable values to normalize to.`)
  const f = mode === "% of control" ? 100 / m : 1 / m
  return { groups: groups.map((g) => ({ ...g, values: g.values.map((v) => v * f) })), label: mode === "% of control" ? `% of ${ref.name}` : `Fold of ${ref.name}` }
}
