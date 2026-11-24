import { forwardRef } from "react"

import type { ChartSpec } from "../lib/specs"
import { ColumnChart } from "./ColumnChart"
import { BarsChart, SplitViolinChart } from "./MoreCharts"
import { GroupedChart, Heatmap, PieChart } from "./OtherCharts"
import { XYChart } from "./XYChart"

/** Picks the renderer for a chart spec. */
export const ChartRenderer = forwardRef<SVGSVGElement, { spec: ChartSpec }>(function ChartRenderer({ spec }, ref) {
  switch (spec.kind) {
    case "column":
      return <ColumnChart ref={ref} spec={spec} />
    case "xy":
      return <XYChart ref={ref} spec={spec} />
    case "grouped":
      return <GroupedChart ref={ref} spec={spec} />
    case "heatmap":
      return <Heatmap ref={ref} spec={spec} />
    case "bars":
      return <BarsChart ref={ref} spec={spec} />
    case "split":
      return <SplitViolinChart ref={ref} spec={spec} />
    default:
      return <PieChart ref={ref} spec={spec} />
  }
})
