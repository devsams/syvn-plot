import { createContext, useContext } from "react"

import type { ChartEdits } from "../lib/graphSpec"
import type { ChartSpec } from "../lib/specs"

/** Chart / StatsTable components read their edits and write changes back into graphSpec. */
export type EditApi = {
  edit: (kind: "chart" | "table", index: number, patch: ChartEdits) => void
  get: (index: number) => { base: ChartSpec; edits: ChartEdits } | null
}
export const EditContext = createContext<EditApi | null>(null)
export const useEditApi = () => useContext(EditContext)
export const useLabelEdit = () => useContext(EditContext)?.edit ?? null

/** Live controls inside the A2UI surface patch /graphSpec through this. */
export type GraphControlApi = { patch: (path: string, value: unknown) => void }
export const GraphControlContext = createContext<GraphControlApi | null>(null)
export const useGraphControl = () => useContext(GraphControlContext)

/** AI actions surfaced inside the graph (e.g. "Polish with AI"); only available with an API key. */
export type AiTask = "summarize" | "advise" | "polish" | "cleanup"
export type AiActionsApi = { available: boolean; run: (task: AiTask) => void }
export const AiActionsContext = createContext<AiActionsApi | null>(null)
export const useAiActions = () => useContext(AiActionsContext)
