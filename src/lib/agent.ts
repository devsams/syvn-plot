/**
 * Turns an analysis result into A2UI v0.9 messages:
 * createSurface → updateComponents → updateDataModel.
 */
import type { ChartSpec, TableSpec } from "./specs"

export const CATALOG_ID = "https://benchplot.local/catalogs/graphs/v1/catalog.json"
export const SURFACE_ID = "results"

export function surfaceMessages(surfaceId: string, content: { title?: string; headline: string; charts: ChartSpec[]; tables: TableSpec[] }) {
  const { title, headline, charts, tables } = content
  const ids: string[] = []
  const components: Record<string, unknown>[] = []
  if (title) {
    components.push({ id: "title", component: "Text", variant: "h3", text: { path: "/title" } })
    ids.push("title")
  }
  components.push({ id: "headline", component: "Text", variant: title ? "caption" : "body", text: { path: "/headline" } })
  ids.push("headline")

  charts.forEach((_, i) => {
    components.push({ id: `chart_card_${i}`, component: "Card", child: `chart_${i}` })
    components.push({ id: `chart_${i}`, component: "Chart", index: i, spec: { path: `/charts/${i}` } })
  })
  if (charts.length) {
    components.push({ id: "chart_grid", component: "ChartGrid", children: charts.map((_, i) => `chart_card_${i}`) })
    ids.push("chart_grid")
  }

  tables.forEach((_, i) => {
    components.push({ id: `table_card_${i}`, component: "Card", child: `table_${i}` })
    components.push({ id: `table_${i}`, component: "StatsTable", index: i, spec: { path: `/tables/${i}` } })
    ids.push(`table_card_${i}`)
  })

  components.unshift({ id: "root", component: "Column", children: ids })

  return [
    { version: "v0.9" as const, createSurface: { surfaceId, catalogId: CATALOG_ID } },
    { version: "v0.9" as const, updateComponents: { surfaceId, components } },
    { version: "v0.9" as const, updateDataModel: { surfaceId, path: "/", value: { title: title ?? "", headline, charts, tables } } },
  ]
}
