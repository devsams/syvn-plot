import { createContext, useContext } from "react"

/** Drawing area in SVG user units; margins grow a little with the canvas. */
export type ChartSize = { W: number; H: number; M: { top: number; right: number; bottom: number; left: number } }

export const DEFAULT_SIZE: ChartSize = makeSize(520, 360)

export function makeSize(W: number, H: number): ChartSize {
  return { W, H, M: { top: 40, right: 20, bottom: 64, left: 72 } }
}

export const SizeContext = createContext<ChartSize>(DEFAULT_SIZE)
export const useChartSize = () => useContext(SizeContext)

/**
 * Export presets. `width`/`height` are the physical size; `W`×`H` is the
 * layout in SVG units, chosen so the 12-unit tick labels print at ~7–8 pt
 * for journal sizes (journal guidance: 6–8 pt minimum) and larger on slides/posters.
 */
export type SizePreset = { id: string; label: string; use: string; width: number; height: number; unit: "mm" | "px"; W: number; H: number }

export const SIZE_PRESETS: SizePreset[] = [
  { id: "screen", label: "Default (13:9)", use: "Same as on screen", width: 137.6, height: 95.3, unit: "mm", W: 520, H: 360 },
  { id: "single", label: "Journal single column · 85 × 64 mm (4:3)", use: "Most journals' 1-column figure", width: 85, height: 64, unit: "mm", W: 380, H: 286 },
  { id: "onehalf", label: "Journal 1.5 column · 114 × 86 mm (4:3)", use: "Wider single panel", width: 114, height: 86, unit: "mm", W: 470, H: 355 },
  { id: "double", label: "Journal double column · 174 × 116 mm (3:2)", use: "Full-width figure", width: 174, height: 116, unit: "mm", W: 660, H: 440 },
  { id: "square", label: "Square panel · 85 × 85 mm (1:1)", use: "Multi-panel figures, posters, social", width: 85, height: 85, unit: "mm", W: 380, H: 380 },
  { id: "portrait", label: "Portrait panel · 85 × 113 mm (3:4)", use: "Tall plots: forest, ranked bars, heatmaps", width: 85, height: 113, unit: "mm", W: 380, H: 506 },
  { id: "slide", label: "Slide 16:9 · 1920 × 1080 px", use: "PowerPoint / Keynote / Google Slides", width: 1920, height: 1080, unit: "px", W: 800, H: 450 },
  { id: "poster", label: "A4 landscape · 297 × 210 mm (√2)", use: "Posters, printed handouts, reports", width: 297, height: 210, unit: "mm", W: 760, H: 537 },
]

export const presetById = (id: string) => SIZE_PRESETS.find((p) => p.id === id) ?? SIZE_PRESETS[0]
