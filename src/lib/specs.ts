/** Chart and table specs: plain JSON that travels in the A2UI data model. */
import type { Comparison, TestResult } from "./stats"

export type ColumnStyle = "bar" | "scatter" | "box" | "violin"
export type ErrorKind = "sd" | "sem" | "ci"

export type Group = { name: string; values: number[] }

/** Groups on the X axis (Prism "Column" graph). */
export type ColumnChartSpec = {
  kind: "column"
  title: string
  yLabel: string
  style: ColumnStyle
  error: ErrorKind
  groups: Group[]
  test: TestResult | null
  comparisons?: Comparison[]
  /** Name of the multiple-comparisons procedure (Holm–Šídák, Tukey, Dunnett, Dunn's, Games–Howell…). */
  comparisonMethod?: string
  /** Draw a line joining the i-th value of every group (before–after). */
  paired?: boolean
  logY?: boolean
  colors?: string[]
}

export type XYPoint = { x: number; y: number; lo?: number; hi?: number; label?: string; /** histogram bin edges */ bin?: [number, number] }

export type XYSeries = {
  name: string
  points: XYPoint[]
  mode: "points" | "line" | "line+points" | "step" | "bars"
  color?: string
  dashed?: boolean
  size?: number
  hideInLegend?: boolean
  barWidth?: number
  /** Small vertical ticks at these points (censored subjects). */
  ticks?: XYPoint[]
}

export type XYChartSpec = {
  kind: "xy"
  title: string
  xLabel: string
  yLabel: string
  xIsDate?: boolean
  logX?: boolean
  logY?: boolean
  yDomain?: [number, number]
  series: XYSeries[]
  refLines?: { axis: "x" | "y"; value: number; label?: string }[]
  note?: string
}

/** Categories on X, several series per category (two-way, contingency, qPCR). */
export type GroupedChartSpec = {
  kind: "grouped"
  title: string
  yLabel: string
  categories: string[]
  series: { name: string; values: (number | null)[]; err?: (number | null)[]; points?: number[][] }[]
  mode: "grouped" | "stacked" | "percent"
  note?: string
  logY?: boolean
  refLine?: number
  colors?: string[]
}

export type HeatmapSpec = {
  kind: "heatmap"
  title: string
  rows: string[]
  cols: string[]
  values: (number | null)[][]
  scale: "sequential" | "diverging"
  domain?: [number, number]
  legendLabel?: string
  showValues?: boolean
  colorScale?: string
}

export type PieSpec = { kind: "pie"; title: string; slices: { label: string; value: number }[]; donut?: boolean; colors?: string[] }

/** One bar or point per label: waterfall, ranked (horizontal) bars, forest plots. */
export type BarsSpec = {
  kind: "bars"
  title: string
  valueLabel: string
  labels: string[]
  values: number[]
  lo?: (number | null)[]
  hi?: (number | null)[]
  colors?: string[]
  orientation: "vertical" | "horizontal"
  mark: "bar" | "point"
  logScale?: boolean
  refLines?: { value: number; label?: string }[]
  legend?: { name: string; color: string }[]
  note?: string
}

/** Two distributions per category, drawn as the left and right halves of one violin. */
export type SplitViolinSpec = {
  kind: "split"
  title: string
  yLabel: string
  categories: string[]
  sides: [string, string]
  values: [number[][], number[][]]
  note?: string
  colors?: string[]
}

/** Free text placed on a graph; x/y are fractions of the canvas so it survives resizing. */
export type Annotation = { id: string; text: string; fx: number; fy: number; size: number; color: string; bold?: boolean }

/** Edits drawn on top of a rendered graph: text replacements (original → new) and added labels. */
export type Decor = { renames?: Record<string, string>; annotations?: Annotation[] }

export type ChartSpec = (ColumnChartSpec | XYChartSpec | GroupedChartSpec | HeatmapSpec | PieSpec | BarsSpec | SplitViolinSpec) & { decor?: Decor }

export type TableSpec = { title: string; columns: string[]; rows: (string | number | null)[][] }
