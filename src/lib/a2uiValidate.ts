/**
 * Strict checks on A2UI messages coming from the AI before anything is rendered:
 * message shape, surface id, allowed operations and paths, the locked component
 * catalog, and every column/value in the resulting graphSpec against the CSV.
 * Problems are phrased for researchers, not developers.
 */
import { z } from "zod"

import { GraphSpecSchema, SURFACE_ID, chartTypesFor, normalizeSpec, setPath, validateGraphSpec, type GraphSpec } from "./graphSpec"
import type { Dataset } from "./parse"

/** The only component types a research-graph surface may contain. */
export const LOCKED_COMPONENTS = ["Column", "Row", "Text", "Card", "Chart", "ChartGrid", "StatsTable", "ChartTypeControl", "ScaleControl", "FilterControl", "ExportButton", "FigureText", "TestControl"] as const

const ComponentSchema = z.object({ id: z.string().min(1), component: z.string().min(1) }).passthrough()

const MessageSchema = z
  .object({
    version: z.literal("v0.9"),
    createSurface: z.unknown().optional(),
    deleteSurface: z.unknown().optional(),
    updateDataModel: z.object({ surfaceId: z.string(), path: z.string(), value: z.unknown() }).optional(),
    updateComponents: z.object({ surfaceId: z.string(), components: z.array(ComponentSchema) }).optional(),
  })
  .strict()

export type ComponentOverride = { id: string; component: string; [prop: string]: unknown }

export type AgentCheck = {
  ok: boolean
  spec: GraphSpec
  overrides: ComponentOverride[]
  problems: string[]
  changes: string[]
}

const describe = (v: unknown) => {
  const s = typeof v === "string" ? `“${v}”` : JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + "…" : s
}

export function validateAgentMessages(messages: unknown[], ctx: { spec: GraphSpec; ds: Dataset; components: { id: string; component: string }[] }): AgentCheck {
  const problems: string[] = []
  const changes: string[] = []
  const overrides: ComponentOverride[] = []
  let candidate: { graphSpec: GraphSpec } = { graphSpec: ctx.spec }
  const known = new Map(ctx.components.map((c) => [c.id, c.component]))

  messages.forEach((raw, n) => {
    const where = messages.length > 1 ? ` (change ${n + 1})` : ""
    const parsed = MessageSchema.safeParse(raw)
    if (!parsed.success) {
      problems.push(`The AI sent an edit BenchPlot couldn't understand${where}, so it was ignored.`)
      return
    }
    const m = parsed.data
    const ops = ["createSurface", "deleteSurface", "updateDataModel", "updateComponents"].filter((k) => m[k as keyof typeof m] !== undefined)
    if (ops.length !== 1) {
      problems.push(`An AI edit${where} tried to do several things at once, so it was ignored.`)
      return
    }
    if (m.createSurface !== undefined || m.deleteSurface !== undefined) {
      problems.push("The AI tried to replace the whole graph instead of editing it. Only edits to the current graph are allowed.")
      return
    }
    if (m.updateDataModel) {
      const { surfaceId, path, value } = m.updateDataModel
      if (surfaceId !== SURFACE_ID) return void problems.push(`An AI edit${where} was aimed at a different graph, so it was ignored.`)
      if (path !== "/graphSpec" && !path.startsWith("/graphSpec/")) return void problems.push(`The AI tried to change “${path}” directly. It may only change the graph settings, so that edit was ignored.`)
      candidate = setPath(candidate, path, value)
      changes.push(path === "/graphSpec" ? "Graph settings replaced" : `${path.replace("/graphSpec/", "").replace(/\//g, " › ")} → ${describe(value)}`)
      return
    }
    if (m.updateComponents) {
      const { surfaceId, components } = m.updateComponents
      if (surfaceId !== SURFACE_ID) return void problems.push(`An AI edit${where} was aimed at a different graph, so it was ignored.`)
      for (const c of components) {
        if (!(LOCKED_COMPONENTS as readonly string[]).includes(c.component)) problems.push(`The AI tried to add a “${c.component}” element, which isn't allowed on this graph.`)
        else if (!known.has(c.id)) problems.push(`The AI tried to change an element (“${c.id}”) that doesn't exist on this graph.`)
        else if (known.get(c.id) !== c.component) problems.push(`The AI tried to turn “${c.id}” into a different kind of element, which isn't allowed.`)
        else if ("children" in c || "child" in c) problems.push(`The AI tried to rearrange the layout of “${c.id}”, which isn't allowed.`)
        else {
          overrides.push(c as ComponentOverride)
          changes.push(`${c.id} display updated`)
        }
      }
    }
  })

  // Shape check, then normalize (a new analysis brings its own roles/chart type), then check columns, values and kinds.
  const shape = GraphSpecSchema.safeParse(candidate.graphSpec)
  if (!shape.success) {
    problems.push(...validateGraphSpec(candidate.graphSpec, ctx.ds))
    return { ok: false, spec: ctx.spec, overrides: [], problems, changes }
  }
  const spec = normalizeSpec(shape.data, ctx.spec, ctx.ds)
  const askedType = shape.data.chartType !== ctx.spec.chartType ? shape.data.chartType : null
  if (askedType && spec.chartType !== askedType) problems.push(`That graph can be drawn as: ${chartTypesFor(spec.analysis).join(", ")} — not “${askedType}”.`)
  problems.push(...validateGraphSpec(spec, ctx.ds).filter((p) => !problems.includes(p)))
  return { ok: problems.length === 0, spec: problems.length ? ctx.spec : spec, overrides: problems.length ? [] : overrides, problems, changes }
}
