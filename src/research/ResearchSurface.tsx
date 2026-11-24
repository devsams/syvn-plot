import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react/v0_9"

import { graphsCatalog } from "../a2ui/catalog"
import type { ComponentOverride } from "../lib/a2uiValidate"
import { CATALOG_ID } from "../lib/agent"
import { analysisById } from "../lib/analysis-defs"
import {
  SURFACE_ID,
  analysisKey,
  applyFilters,
  chartTypesFor,
  editsFor,
  filterColumns,
  normalizeSpec,
  presentCharts,
  presentTables,
  runSpecAnalysis,
  setPath,
  validateGraphSpec,
  withChartEdit,
  type GraphSpec,
} from "../lib/graphSpec"
import { figureText, type FigureText as FigureTextType } from "../lib/figureText"
import type { Result } from "../lib/analyses"
import type { ChartSpec } from "../lib/specs"
import type { Dataset } from "../lib/parse"
import { EditContext, GraphControlContext, type EditApi } from "./context"

type Msg = Record<string, unknown>

/** The component tree of the research-graph surface (ids are stable so patches update in place). */
export function layoutComponents(chartCount: number, tableCount: number, overrides: ComponentOverride[] = []) {
  const ids = ["title", "headline", "controls"]
  const components: Record<string, unknown>[] = [
    { id: "title", component: "Text", variant: "h3", text: { path: "/title" } },
    { id: "headline", component: "Text", variant: "caption", text: { path: "/headline" } },
    { id: "controls", component: "Row", children: ["ctl_type", "ctl_test", "ctl_x", "ctl_y", "ctl_filter", "ctl_export"] },
    { id: "ctl_test", component: "TestControl", options: { path: "/ui/testOptions" }, test: { path: "/graphSpec/params/test" }, posthoc: { path: "/graphSpec/params/posthoc" } },
    { id: "ctl_type", component: "ChartTypeControl", value: { path: "/graphSpec/chartType" }, options: { path: "/ui/chartTypes" }, errorBars: { path: "/graphSpec/errorBars" }, showErrorBars: { path: "/ui/usesError" } },
    { id: "ctl_x", component: "ScaleControl", axis: "x", value: { path: "/graphSpec/xScale" } },
    { id: "ctl_y", component: "ScaleControl", axis: "y", value: { path: "/graphSpec/yScale" } },
    { id: "ctl_filter", component: "FilterControl", filters: { path: "/graphSpec/filters" }, columns: { path: "/ui/filterColumns" } },
    { id: "ctl_export", component: "ExportButton", chart: { path: "/charts/0" } },
  ]
  for (let i = 0; i < chartCount; i++) {
    components.push({ id: `chart_card_${i}`, component: "Card", child: `chart_${i}` })
    components.push({ id: `chart_${i}`, component: "Chart", index: i, spec: { path: `/charts/${i}` } })
  }
  if (chartCount) {
    components.push({ id: "chart_grid", component: "ChartGrid", children: Array.from({ length: chartCount }, (_, i) => `chart_card_${i}`) })
    ids.push("chart_grid")
  }
  components.push({ id: "figure_text_card", component: "Card", child: "figure_text" })
  components.push({ id: "figure_text", component: "FigureText", legend: { path: "/figureText/legend" }, methods: { path: "/figureText/methods" }, edited: { path: "/figureText/edited" } })
  ids.push("figure_text_card")
  for (let i = 0; i < tableCount; i++) {
    components.push({ id: `table_card_${i}`, component: "Card", child: `table_${i}` })
    components.push({ id: `table_${i}`, component: "StatsTable", index: i, spec: { path: `/tables/${i}` } })
    ids.push(`table_card_${i}`)
  }
  components.unshift({ id: "root", component: "Column", children: ids })
  // AI display tweaks to existing components (validated: same id and type, no layout changes).
  for (const o of overrides) {
    const target = components.find((c) => c.id === o.id && c.component === o.component)
    if (target) Object.assign(target, Object.fromEntries(Object.entries(o).filter(([k]) => !["id", "component", "children", "child"].includes(k))))
  }
  return components
}

type Props = {
  ds: Dataset
  spec: GraphSpec
  onSpec: (next: GraphSpec, source: string) => void
  title: string
  overrides: ComponentOverride[]
  showMessages: boolean
  agentLog: Msg[]
  onComponents?: (list: { id: string; component: string }[]) => void
  onComputed?: (c: { result: Result; charts: ChartSpec[]; figureText: FigureTextType } | null) => void
}

/**
 * Renders the graph inside one long-lived A2UI surface ("research-graph").
 * Mount with key = dataset identity. After createSurface, every change goes out
 * as minimal updateComponents / updateDataModel patches — the view is never reset.
 */
export function ResearchSurface({ ds, spec, onSpec, title, overrides, showMessages, agentLog, onComponents, onComputed }: Props) {
  const processor = useMemo(() => new MessageProcessor<ReactCatalogComponent>([graphsCatalog]), [])
  const [surface, setSurface] = useState<ReturnType<typeof getSurface>>(null)
  const sent = useRef<{ components?: string; data: Record<string, string> }>({ data: {} })
  const log = useRef<Msg[]>([])
  const [, bump] = useState(0)

  const problems = useMemo(() => validateGraphSpec(spec, ds), [spec, ds])
  const specOk = problems.length === 0
  // Re-run the analysis only when analysis-level fields change; labels, scales and colors are applied after.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => (specOk ? runSpecAnalysis(ds, spec) : null), [ds, specOk, analysisKey(spec)])
  const charts = useMemo(() => (result ? presentCharts(result.charts, spec) : []), [result, spec])
  const tables = useMemo(() => (result ? presentTables(result.tables, spec) : []), [result, spec])
  const def = analysisById(spec.analysis)
  const shownRows = useMemo(() => (spec.filters.length ? applyFilters(ds, spec.filters).rowCount : ds.rowCount), [ds, spec.filters])
  const headline = result ? `${shownRows === ds.rowCount ? `${ds.rowCount} rows` : `${shownRows} of ${ds.rowCount} rows (filtered)`} · ${def?.label ?? spec.analysis} · ${result.headline}` : ""

  const text = useMemo(() => (result ? spec.figureText ?? figureText(spec, result, charts, shownRows, ds.rowCount) : null), [result, spec, charts, shownRows, ds.rowCount])
  useEffect(() => {
    onComputed?.(result && text ? { result, charts, figureText: text } : null)
  }, [result, charts, text, onComputed])

  // Sync: compute the desired components + data model and send only what changed.
  useEffect(() => {
    if (!result) return
    const out: Msg[] = []
    if (!sent.current.components) out.push({ version: "v0.9", createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } })
    const components = layoutComponents(charts.length, tables.length, overrides)
    const cJson = JSON.stringify(components)
    if (cJson !== sent.current.components) {
      out.push({ version: "v0.9", updateComponents: { surfaceId: SURFACE_ID, components } })
      sent.current.components = cJson
      onComponents?.(components.map((c) => ({ id: String(c.id), component: String(c.component) })))
    }
    const parts: Record<string, unknown> = {
      "/graphSpec": spec,
      "/title": title,
      "/headline": headline,
      "/figureText": { ...(text ?? { legend: "", methods: "" }), edited: !!spec.figureText },
      "/ui": { chartTypes: chartTypesFor(spec.analysis), usesError: !!def?.usesError, filterColumns: filterColumns(ds), testOptions: testOptions(spec) },
    }
    const prevCharts = Number(sent.current.data["#charts"] ?? -1)
    const prevTables = Number(sent.current.data["#tables"] ?? -1)
    if (prevCharts !== charts.length) parts["/charts"] = charts
    else charts.forEach((c, i) => (parts[`/charts/${i}`] = c))
    if (prevTables !== tables.length) parts["/tables"] = tables
    else tables.forEach((t, i) => (parts[`/tables/${i}`] = t))
    for (const [path, value] of Object.entries(parts)) {
      const j = JSON.stringify(value)
      if (sent.current.data[path] === j) continue
      sent.current.data[path] = j
      if (path === "/charts") charts.forEach((c, i) => (sent.current.data[`/charts/${i}`] = JSON.stringify(c)))
      if (path === "/tables") tables.forEach((t, i) => (sent.current.data[`/tables/${i}`] = JSON.stringify(t)))
      out.push({ version: "v0.9", updateDataModel: { surfaceId: SURFACE_ID, path, value } })
    }
    sent.current.data["#charts"] = String(charts.length)
    sent.current.data["#tables"] = String(tables.length)
    if (!out.length) return
    try {
      processor.processMessages(out as never)
    } catch (e) {
      console.error(e)
    }
    log.current = [...log.current, ...out.map((m) => ({ ...m, _from: "app" }))].slice(-60)
    if (!surface) setSurface(getSurface(processor))
    if (showMessages) bump((n) => n + 1)
  })

  const editApi = useMemo<EditApi>(
    () => ({
      edit: (kind, index, patch) => onSpec(withChartEdit(spec, kind, index, patch), "chart edit"),
      get: (index) => (result?.charts[index] ? { base: result.charts[index], edits: editsFor(spec, index) } : null),
    }),
    [onSpec, spec, result],
  )
  const patch = useCallback((path: string, value: unknown) => onSpec(normalizeSpec(setPath({ graphSpec: spec }, path, value).graphSpec, spec, ds), "control"), [onSpec, spec, ds])
  const controlApi = useMemo(() => ({ patch }), [patch])

  const shownLog = showMessages ? [...log.current, ...agentLog.map((m) => ({ ...m, _from: "agent" }))].slice(-40) : []

  return (
    <EditContext.Provider value={editApi}>
      <GraphControlContext.Provider value={controlApi}>
        {!specOk && (
          <div className="problem">
            <strong>This graph can't be drawn yet:</strong>
            <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {showMessages && <pre className="messages">{JSON.stringify(shownLog, null, 2).slice(-30000)}</pre>}
        {surface ? <A2uiSurface surface={surface} /> : specOk ? <div className="dim">Drawing…</div> : null}
      </GraphControlContext.Provider>
    </EditContext.Provider>
  )
}

/** Test / multiple-comparison choices for the current analysis (null when it has none). */
function testOptions(spec: GraphSpec) {
  const def = analysisById(spec.analysis)
  const test = def?.params?.find((p) => p.key === "test")?.values ?? null
  const posthoc = def?.params?.find((p) => p.key === "posthoc")?.values ?? null
  const t = spec.params.test ?? ""
  const autoPosthoc = posthoc ? (t.startsWith("Mann") ? "Dunn's (automatic)" : t === "Welch t / Welch ANOVA" ? "Games–Howell (automatic)" : null) : null
  return test || posthoc ? { test, posthoc, autoPosthoc } : null
}

function getSurface(p: MessageProcessor<ReactCatalogComponent>) {
  return p.model.surfacesMap.get(SURFACE_ID) ?? null
}
