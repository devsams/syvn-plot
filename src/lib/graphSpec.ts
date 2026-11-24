/**
 * The canonical graph description kept in the A2UI data model at /graphSpec.
 * Everything on screen is derived from it: the setup panel, live controls,
 * chart edits and AI chat all change the graph by patching this object.
 */
import { z } from "zod"

import { applyColors } from "../charts/colors"
import { THEMES } from "../charts/palettes"
import { ANALYSES, analysisById, type AnalysisId, type ColumnKindName } from "./analysis-defs"
import { detectAll, levelsOf, runAnalysis, type Params, type Result, type Roles } from "./analyses"
import { toNumber, type Column, type Dataset } from "./parse"
import type { Annotation, ChartSpec, ColumnStyle, ErrorKind, TableSpec } from "./specs"

export const SURFACE_ID = "research-graph"

export const CHART_TYPES = ["auto", "bar", "scatter", "box", "violin", "line"] as const
export type ChartType = (typeof CHART_TYPES)[number]
export type AxisScale = "auto" | "linear" | "log"

export const FilterSchema = z.object({
  column: z.string(),
  op: z.enum(["include", "exclude", "min", "max"]),
  values: z.array(z.string()).optional(),
  value: z.number().optional(),
})
export type Filter = z.infer<typeof FilterSchema>

const AnnotationSchema = z.object({ id: z.string(), text: z.string(), fx: z.number().min(0).max(1), fy: z.number().min(0).max(1), size: z.number().min(4).max(72), color: z.string(), bold: z.boolean().optional() })

/** Per-chart extras (colors, text replacements, secondary charts' labels). Keyed by chart index ("0", "1"…) or "t<i>" for tables. */
export const ChartEditsSchema = z.object({
  title: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  theme: z.string().optional(),
  colors: z.record(z.string()).optional(),
  colorScale: z.string().optional(),
  renames: z.record(z.string()).optional(),
  annotations: z.array(AnnotationSchema).optional(),
})
export type ChartEdits = z.infer<typeof ChartEditsSchema>

export const GraphSpecSchema = z.object({
  analysis: z.string(),
  chartType: z.enum(CHART_TYPES),
  xColumn: z.string().nullable(),
  yColumns: z.array(z.string()),
  groupBy: z.string().nullable(),
  xScale: z.enum(["auto", "linear", "log"]),
  yScale: z.enum(["auto", "linear", "log"]),
  title: z.string().nullable(),
  xLabel: z.string().nullable(),
  yLabel: z.string().nullable(),
  filters: z.array(FilterSchema),
  annotations: z.array(AnnotationSchema),
  palette: z.string().nullable(),
  errorBars: z.enum(["sd", "sem", "ci"]),
  roles: z.record(z.array(z.string())),
  params: z.record(z.string()),
  chartEdits: z.record(ChartEditsSchema),
  /** Legend/methods text the researcher accepted from "Polish with AI" (null = generated text). */
  figureText: z.object({ legend: z.string(), methods: z.string() }).nullable().optional(),
})
export type GraphSpec = z.infer<typeof GraphSpecSchema>

/** Fields that change the analysis itself (anything else only changes how it looks). */
const ANALYSIS_FIELDS = ["analysis", "chartType", "roles", "params", "filters", "errorBars"] as const
export const analysisKey = (s: GraphSpec) => JSON.stringify(ANALYSIS_FIELDS.map((k) => s[k]))

// --- chart types ---------------------------------------------------------------

/** The chart types that make sense for an analysis (first = default). */
export function chartTypesFor(analysis: string): ChartType[] {
  const def = analysisById(analysis)
  if (def?.usesStyle) return ["bar", "scatter", "box", "violin"]
  if (analysis === "two_way") return ["bar", "violin"]
  if (analysis === "xy" || analysis === "time_course") return ["line", "scatter"]
  return ["auto"]
}

// --- axes <-> roles ------------------------------------------------------------

export function axesFromRoles(analysis: string, roles: Roles) {
  const def = analysisById(analysis)
  const pick = (axis: "x" | "y" | "group") => def?.roles.filter((r) => r.axis === axis).flatMap((r) => roles[r.key] ?? []) ?? []
  return { xColumn: pick("x")[0] ?? null, yColumns: pick("y"), groupBy: pick("group")[0] ?? null }
}

export function rolesFromAxes(analysis: string, roles: Roles, axes: { xColumn: string | null; yColumns: string[]; groupBy: string | null }): Roles {
  const def = analysisById(analysis)
  const next: Roles = { ...roles }
  for (const r of def?.roles ?? []) {
    if (r.axis === "x") next[r.key] = axes.xColumn ? [axes.xColumn] : []
    if (r.axis === "group") next[r.key] = axes.groupBy ? [axes.groupBy] : []
    if (r.axis === "y") next[r.key] = r.multiple ? [...axes.yColumns] : axes.yColumns.slice(0, 1)
  }
  return next
}

// --- creation ------------------------------------------------------------------

export function specFromDetection(ds: Dataset, analysis: AnalysisId, overrides: { roles?: Roles; params?: Params; style?: ColumnStyle; error?: ErrorKind } = {}): GraphSpec {
  const d = detectAll(ds).find((x) => x.id === analysis)!
  const roles = overrides.roles ?? d.roles
  const types = chartTypesFor(analysis)
  const params = { ...d.params, ...(overrides.params ?? {}) }
  const chartType: ChartType = analysis === "two_way" && params.chart === "split violin" ? "violin" : overrides.style && types.includes(overrides.style) ? overrides.style : types[0]
  return {
    analysis,
    chartType,
    ...axesFromRoles(analysis, roles),
    xScale: "auto",
    yScale: "auto",
    title: null,
    xLabel: null,
    yLabel: null,
    filters: [],
    annotations: [],
    palette: null,
    errorBars: overrides.error ?? "sd",
    roles,
    params,
    chartEdits: {},
  }
}

/**
 * Makes a patched spec consistent: a new analysis gets its own roles/params,
 * changed x/y/group fields flow into roles, and the canonical x/y/group are
 * always re-derived from roles.
 */
export function normalizeSpec(next: GraphSpec, prev: GraphSpec | null, ds: Dataset): GraphSpec {
  let s = { ...next }
  const axesChanged = prev && (s.xColumn !== prev.xColumn || JSON.stringify(s.yColumns) !== JSON.stringify(prev.yColumns) || s.groupBy !== prev.groupBy)
  if (prev && s.analysis !== prev.analysis) {
    const d = detectAll(ds).find((x) => x.id === s.analysis)
    s.roles = d?.roles ?? {}
    s.params = { ...(d?.params ?? {}), ...diff(s.params, prev.params) }
    if (axesChanged) s.roles = rolesFromAxes(s.analysis, s.roles, s)
    if (!chartTypesFor(s.analysis).includes(s.chartType)) s.chartType = chartTypesFor(s.analysis)[0]
  } else if (axesChanged) {
    s.roles = rolesFromAxes(s.analysis, s.roles, s)
  }
  if (s.analysis === "two_way") s.params = { ...s.params, chart: s.chartType === "violin" ? "split violin" : "grouped bars" }
  s = { ...s, ...axesFromRoles(s.analysis, s.roles) }
  return s
}

const diff = (a: Params, b: Params) => Object.fromEntries(Object.entries(a).filter(([k, v]) => b[k] !== v))

// --- validation ----------------------------------------------------------------

const list = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} … (${xs.length} in total)` : xs.join(", "))
const kindWord: Record<ColumnKindName, string> = { number: "numbers", category: "groups/categories", text: "text labels", date: "dates" }

/** Checks a spec against the loaded data. Returns plain-language problems (empty = OK). */
export function validateGraphSpec(spec: unknown, ds: Dataset): string[] {
  const parsed = GraphSpecSchema.safeParse(spec)
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 4).map((i) => {
      const field = i.path.join(".") || "graph settings"
      if (i.code === "invalid_enum_value") return `“${field}” must be one of: ${i.options.join(", ")}.`
      return `The setting “${field}” has the wrong kind of value (${i.message.toLowerCase()}).`
    })
  }
  const s = parsed.data
  const problems: string[] = []
  const names = ds.columns.map((c) => c.name)
  const col = (n: string) => ds.columns.find((c) => c.name === n)
  const missing = (n: string, where: string) => problems.push(`There's no column called “${n}” in ${ds.fileName} (used for ${where}). Columns in this file: ${list(names)}.`)

  const def = analysisById(s.analysis)
  if (!def) problems.push(`Syvn Plot doesn't have a graph type called “${s.analysis}”. Options include: ${list(ANALYSES.map((a) => a.id), 12)}.`)
  if (s.xColumn && !col(s.xColumn)) missing(s.xColumn, "the X axis")
  for (const y of s.yColumns) if (!col(y)) missing(y, "the Y axis")
  if (s.groupBy && !col(s.groupBy)) missing(s.groupBy, "grouping")
  for (const [key, cols] of Object.entries(s.roles)) for (const n of cols) if (!col(n) && n !== s.xColumn && !s.yColumns.includes(n) && n !== s.groupBy) missing(n, def?.roles.find((r) => r.key === key)?.label ?? key)

  if (def) {
    for (const r of def.roles) {
      for (const n of s.roles[r.key] ?? []) {
        const c = col(n)
        if (c && !r.kinds.includes(c.kind) && !(r.kinds.includes("category") && c.kind === "text")) {
          const fits = ds.columns.filter((x) => r.kinds.includes(x.kind)).map((x) => x.name)
          problems.push(`“${n}” contains ${kindWord[c.kind]}, so it can't be used as “${r.label}”.${fits.length ? ` Columns that fit: ${list(fits, 5)}.` : ""}`)
        }
      }
    }
    for (const pd of def.params ?? []) {
      const v = s.params[pd.key]
      if (pd.values && v !== undefined && v !== "" && !pd.values.includes(v)) problems.push(`“${v}” isn't an option for “${pd.label}”. Options: ${pd.values.join(", ")}.`)
    }
    if (!chartTypesFor(s.analysis).includes(s.chartType)) problems.push(`A ${def.label} graph can be drawn as: ${chartTypesFor(s.analysis).join(", ")} — not “${s.chartType}”.`)
  }

  for (const f of s.filters) {
    const c = col(f.column)
    if (!c) {
      missing(f.column, "a filter")
      continue
    }
    if (f.op === "include" || f.op === "exclude") {
      const lv = levelsOf(c)
      const lower = new Map(lv.map((l) => [l.toLowerCase(), l]))
      const bad = (f.values ?? []).filter((v) => !lower.has(v.trim().toLowerCase()))
      if (!f.values?.length) problems.push(`The filter on “${f.column}” doesn't list any values.`)
      if (bad.length) problems.push(`${bad.map((b) => `“${b}”`).join(", ")} ${bad.length > 1 ? "aren't values" : "isn't a value"} in “${f.column}”. Values there: ${list(lv)}.`)
    } else {
      if (c.kind !== "number") problems.push(`“${f.column}” isn't numeric, so it can't have a ${f.op === "min" ? "minimum" : "maximum"} filter.`)
      if (typeof f.value !== "number") problems.push(`The ${f.op} filter on “${f.column}” needs a number.`)
    }
  }
  if (!problems.length && s.filters.length && applyFilters(ds, s.filters).rowCount === 0) problems.push("Those filters remove every row — nothing would be left to plot.")
  if (s.palette && !THEMES.some((t) => t.name === s.palette)) problems.push(`There's no palette called “${s.palette}”. Try: ${list(THEMES.map((t) => t.name), 10)}.`)
  return problems
}

// --- filters ---------------------------------------------------------------------

export function applyFilters(ds: Dataset, filters: Filter[]): Dataset {
  if (!filters.length) return ds
  const keep = Array.from({ length: ds.rowCount }, () => true)
  for (const f of filters) {
    const c = ds.columns.find((x) => x.name === f.column)
    if (!c) continue
    const wanted = new Set((f.values ?? []).map((v) => v.trim().toLowerCase()))
    c.values.forEach((v, i) => {
      if (!keep[i]) return
      if (f.op === "include") keep[i] = v !== null && wanted.has(String(v).trim().toLowerCase())
      else if (f.op === "exclude") keep[i] = v === null || !wanted.has(String(v).trim().toLowerCase())
      else {
        const n = toNumber(v)
        keep[i] = n !== null && (f.op === "min" ? n >= (f.value ?? -Infinity) : n <= (f.value ?? Infinity))
      }
    })
  }
  return { ...ds, rowCount: keep.filter(Boolean).length, columns: ds.columns.map((c) => ({ ...c, values: c.values.filter((_, i) => keep[i]) })) }
}

/** Column info for filter controls and the AI. */
export function filterColumns(ds: Dataset) {
  return ds.columns.map((c: Column) => {
    if (c.kind === "number") {
      const v = c.values.filter((x): x is number => typeof x === "number")
      return { name: c.name, kind: c.kind, min: Math.min(...v), max: Math.max(...v) }
    }
    const lv = levelsOf(c)
    return { name: c.name, kind: c.kind, levels: lv.length <= 60 ? lv : lv.slice(0, 60) }
  })
}

// --- running ---------------------------------------------------------------------

/** Analysis-level run (cache with analysisKey). */
export function runSpecAnalysis(ds: Dataset, s: GraphSpec): Result {
  const style: ColumnStyle = s.chartType === "bar" || s.chartType === "scatter" || s.chartType === "box" || s.chartType === "violin" ? s.chartType : "bar"
  const result = runAnalysis(applyFilters(ds, s.filters), s.analysis as AnalysisId, s.roles, s.params, { style, error: s.errorBars })
  if ((s.analysis === "xy" || s.analysis === "time_course") && s.chartType === "scatter")
    result.charts = result.charts.map((c) => (c.kind === "xy" ? { ...c, series: c.series.map((x) => (x.mode === "line+points" ? { ...x, mode: "points" as const } : x)) } : c))
  return result
}

/** Applies the presentation fields (scales, labels, palette, annotations, per-chart edits). */
export function presentCharts(base: ChartSpec[], s: GraphSpec): ChartSpec[] {
  return base.map((c, i) => applyChart(withScales(c, s.xScale, s.yScale), editsFor(s, i)))
}

export function presentTables(base: TableSpec[], s: GraphSpec): TableSpec[] {
  return base.map((t, i) => (s.chartEdits[`t${i}`]?.title !== undefined ? { ...t, title: s.chartEdits[`t${i}`].title! } : t))
}

/** The edits that apply to chart i: the canonical fields drive the first chart; the palette applies to all. */
export function editsFor(s: GraphSpec, i: number): ChartEdits {
  const own = s.chartEdits[String(i)] ?? {}
  if (i !== 0) return { theme: s.palette ?? undefined, ...own }
  return {
    ...own,
    title: s.title ?? own.title,
    xLabel: s.xLabel ?? own.xLabel,
    yLabel: s.yLabel ?? own.yLabel,
    theme: own.theme ?? s.palette ?? undefined,
    annotations: s.annotations.length ? s.annotations : own.annotations,
  }
}

/** Writes a chart edit back into the spec (chart 0 → canonical fields). */
export function withChartEdit(s: GraphSpec, kind: "chart" | "table", i: number, patch: ChartEdits): GraphSpec {
  if (kind === "table") return { ...s, chartEdits: { ...s.chartEdits, [`t${i}`]: { ...(s.chartEdits[`t${i}`] ?? {}), ...patch } } }
  if (i !== 0) return { ...s, chartEdits: { ...s.chartEdits, [String(i)]: { ...(s.chartEdits[String(i)] ?? {}), ...patch } } }
  const { title, xLabel, yLabel, annotations, theme, ...rest } = patch
  const next: GraphSpec = { ...s }
  if ("title" in patch) next.title = title ?? null
  if ("xLabel" in patch) next.xLabel = xLabel ?? null
  if ("yLabel" in patch) next.yLabel = yLabel ?? null
  if ("annotations" in patch) next.annotations = annotations ?? []
  if ("theme" in patch) next.palette = theme ?? null
  if (Object.keys(rest).length) next.chartEdits = { ...s.chartEdits, "0": { ...(s.chartEdits["0"] ?? {}), ...rest } }
  return next
}

export function applyChart(spec: ChartSpec, e: ChartEdits | undefined): ChartSpec {
  if (!e) return spec
  let next = { ...spec } as ChartSpec & { yLabel?: string; xLabel?: string; valueLabel?: string }
  if (e.title !== undefined) next.title = e.title
  if (e.yLabel !== undefined && "yLabel" in next) next.yLabel = e.yLabel
  if (e.yLabel !== undefined && "valueLabel" in next) next.valueLabel = e.yLabel
  if (e.xLabel !== undefined && "xLabel" in next) next.xLabel = e.xLabel
  next = applyColors(next, e.theme, e.colors) as typeof next
  if (e.colorScale && next.kind === "heatmap") next = { ...next, colorScale: e.colorScale }
  if (e.renames || e.annotations) next = { ...next, decor: { renames: e.renames, annotations: e.annotations as Annotation[] | undefined } }
  return next
}

export function withScales(c: ChartSpec, x: AxisScale, y: AxisScale): ChartSpec {
  const ly = y === "auto" ? undefined : y === "log"
  const lx = x === "auto" ? undefined : x === "log"
  if (c.kind === "xy") return { ...c, ...(ly !== undefined ? { logY: ly } : {}), ...(lx !== undefined ? { logX: lx } : {}) }
  if ((c.kind === "column" || c.kind === "grouped") && ly !== undefined) return { ...c, logY: ly }
  if (c.kind === "bars" && ly !== undefined) return { ...c, logScale: ly }
  return c
}

/** Sets a value at a JSON-pointer path ("/graphSpec/yScale") inside an object, immutably. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split("/").filter(Boolean).map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"))
  if (!keys.length) return value as T
  const root: Record<string, unknown> = Array.isArray(obj) ? ([...obj] as never) : { ...(obj as Record<string, unknown>) }
  let cur: Record<string, unknown> = root
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value
    else {
      const child = cur[k]
      cur[k] = Array.isArray(child) ? [...child] : child && typeof child === "object" ? { ...(child as object) } : {}
      cur = cur[k] as Record<string, unknown>
    }
  })
  return root as T
}

/** Renames a column everywhere the spec refers to it. */
export function renameInSpec(s: GraphSpec, from: string, to: string): GraphSpec {
  const r = (n: string) => (n === from ? to : n)
  return {
    ...s,
    xColumn: s.xColumn && r(s.xColumn),
    yColumns: s.yColumns.map(r),
    groupBy: s.groupBy && r(s.groupBy),
    roles: Object.fromEntries(Object.entries(s.roles).map(([k, v]) => [k, v.map(r)])),
    filters: s.filters.map((f) => ({ ...f, column: r(f.column) })),
  }
}
