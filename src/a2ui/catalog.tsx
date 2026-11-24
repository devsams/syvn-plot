/**
 * The locked A2UI catalog for the research-graph surface: four layout/text
 * components from the official v0.9 basic catalog (Column, Row, Text, Card)
 * plus BenchPlot components — Chart, ChartGrid, StatsTable and the live
 * controls (ChartTypeControl, ScaleControl, FilterControl, ExportButton).
 * Nothing else can be rendered, and incoming messages are validated against
 * LOCKED_COMPONENTS before they reach the surface.
 */
import { useState } from "react"
import { z } from "zod"
import { CommonSchemas } from "@a2ui/web_core/v0_9"
import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog"
import { createComponentImplementation } from "@a2ui/react/v0_9"

import { ChartCard } from "../ChartCard"
import { ChartTypeView, ExportView, FigureTextView, FilterView, ScaleView } from "../research/Controls"
import { useLabelEdit } from "../research/context"
import { LOCKED_COMPONENTS } from "../lib/a2uiValidate"
import type { ChartType, Filter } from "../lib/graphSpec"
import { LabelField } from "../LabelField"
import { CATALOG_ID } from "../lib/agent"
import type { ChartSpec, TableSpec } from "../lib/specs"
import { fmt } from "../lib/stats"

const ChartApi = { name: "Chart", schema: z.object({ spec: CommonSchemas.DynamicValue, index: z.number().optional() }) }

const Chart = createComponentImplementation(ChartApi, ({ props }) => {
  const spec = props.spec as unknown as ChartSpec | undefined
  return spec ? <ChartCard spec={spec} index={props.index as number | undefined} /> : null
})

const StatsTableApi = { name: "StatsTable", schema: z.object({ spec: CommonSchemas.DynamicValue, index: z.number().optional() }) }

const cell = (v: unknown) => (v === null || v === undefined ? "–" : typeof v === "number" ? (Number.isInteger(v) && Math.abs(v) < 1e7 ? String(v) : fmt(v, 4)) : String(v))

const StatsTable = createComponentImplementation(StatsTableApi, ({ props }) => {
  const spec = props.spec as unknown as TableSpec | undefined
  const edit = useLabelEdit()
  const [editing, setEditing] = useState(false)
  if (!spec || !spec.rows.length) return null
  const index = props.index as number | undefined
  const canEdit = !!edit && index !== undefined
  const copy = () => void navigator.clipboard.writeText([spec.columns, ...spec.rows].map((r) => r.map((v) => (v === null ? "" : String(v))).join("\t")).join("\n"))
  return (
    <div className="stats">
      <div className="stats-head">
        {editing && canEdit ? (
          <LabelField label="Table title" value={spec.title} onChange={(v) => edit!("table", index!, { title: v })} autoFocus />
        ) : (
          <span className="chart-title" onDoubleClick={() => canEdit && setEditing(true)} title={canEdit ? "Double-click to rename" : undefined}>
            {spec.title}
          </span>
        )}
        <span className="chart-actions">
          {canEdit && (
            <button type="button" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
              {editing ? "Done" : "Rename"}
            </button>
          )}
          <button type="button" onClick={copy}>Copy table</button>
        </span>
      </div>
      <div className="stats-scroll">
        <table>
          <thead>
            <tr>{spec.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {spec.rows.map((row, r) => (
              <tr key={r}>{row.map((v, i) => <td key={i}>{cell(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

const ChartGridApi = { name: "ChartGrid", schema: z.object({ children: CommonSchemas.ChildList }) }

const ChartGrid = createComponentImplementation(ChartGridApi, ({ props, buildChild }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children = (props.children ?? []) as any[]
  return (
    <div className="chart-grid">
      {children.map((child, i) => (
        <div key={typeof child === "string" ? child : (child?.id ?? i)}>{buildChild(child)}</div>
      ))}
    </div>
  )
})

const ChartTypeControlApi = { name: "ChartTypeControl", schema: z.object({ value: CommonSchemas.DynamicString, options: CommonSchemas.DynamicValue, errorBars: CommonSchemas.DynamicString, showErrorBars: CommonSchemas.DynamicBoolean }) }
const ChartTypeControl = createComponentImplementation(ChartTypeControlApi, ({ props }) => (
  <ChartTypeView value={props.value as ChartType} options={(props.options as unknown as ChartType[]) ?? []} errorBars={String(props.errorBars ?? "sd")} showErrorBars={!!props.showErrorBars} />
))

const ScaleControlApi = { name: "ScaleControl", schema: z.object({ axis: z.enum(["x", "y"]), value: CommonSchemas.DynamicString }) }
const ScaleControl = createComponentImplementation(ScaleControlApi, ({ props }) => <ScaleView axis={props.axis as "x" | "y"} value={String(props.value ?? "auto")} />)

const FilterControlApi = { name: "FilterControl", schema: z.object({ filters: CommonSchemas.DynamicValue, columns: CommonSchemas.DynamicValue }) }
const FilterControl = createComponentImplementation(FilterControlApi, ({ props }) => (
  <FilterView filters={(props.filters as unknown as Filter[]) ?? []} columns={(props.columns as unknown as { name: string; kind: string; levels?: string[]; min?: number; max?: number }[]) ?? []} />
))

const ExportButtonApi = { name: "ExportButton", schema: z.object({ chart: CommonSchemas.DynamicValue }) }
const ExportButton = createComponentImplementation(ExportButtonApi, ({ props }) => <ExportView chart={props.chart as unknown as ChartSpec | undefined} />)

const FigureTextApi = { name: "FigureText", schema: z.object({ legend: CommonSchemas.DynamicString, methods: CommonSchemas.DynamicString, edited: CommonSchemas.DynamicBoolean.optional() }) }
const FigureText = createComponentImplementation(FigureTextApi, ({ props }) => <FigureTextView legend={String(props.legend ?? "")} methods={String(props.methods ?? "")} edited={!!props.edited} />)

const BASIC_ALLOWED = ["Column", "Row", "Text", "Card"]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const graphsCatalog = (basicCatalog as any).derive({
  catalogId: CATALOG_ID,
  components: [...BASIC_ALLOWED, Chart, StatsTable, ChartGrid, ChartTypeControl, ScaleControl, FilterControl, ExportButton, FigureText],
})

// Keep the runtime catalog and the validator's allow-list in step.
if (import.meta.env.DEV) {
  const names = [...BASIC_ALLOWED, "Chart", "StatsTable", "ChartGrid", "ChartTypeControl", "ScaleControl", "FilterControl", "ExportButton", "FigureText"].sort().join()
  if (names !== [...LOCKED_COMPONENTS].sort().join()) console.warn("BenchPlot: catalog and LOCKED_COMPONENTS differ")
}
