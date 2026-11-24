/**
 * Colorable items per chart (groups, series, slices, bar colors) and applying a
 * theme plus per-item overrides. Semantic colors (grey "not significant",
 * black fit lines) are kept by themes but can still be overridden one by one.
 */
import type { ChartSpec } from "../lib/specs"
import { THEMES } from "./palettes"
import { PALETTE } from "./scale"

export type ColorItem = { key: string; label: string; color: string }

const themeable = (c: string | undefined) => c === undefined || PALETTE.includes(c)
const at = (list: string[], i: number) => list[((i % list.length) + list.length) % list.length]

/** The items a person can recolor, with their current color. */
export function colorItems(spec: ChartSpec): ColorItem[] {
  switch (spec.kind) {
    case "column":
      return spec.groups.map((g, i) => ({ key: `g:${g.name}`, label: g.name, color: spec.colors?.[i] ?? at(PALETTE, i) }))
    case "grouped":
      return spec.series.map((s, i) => ({ key: `g:${s.name}`, label: s.name, color: spec.colors?.[i] ?? at(PALETTE, i) }))
    case "pie":
      return spec.slices.filter((s) => s.value > 0).map((s, i) => ({ key: `g:${s.label}`, label: s.label, color: spec.colors?.[i] ?? at(PALETTE, i) }))
    case "split":
      return spec.sides.map((s, i) => ({ key: `g:${s}`, label: s, color: spec.colors?.[i] ?? at(PALETTE, i) }))
    case "xy":
      return spec.series.flatMap((s, i) => (s.hideInLegend && spec.series.some((o) => !o.hideInLegend && (o.color ?? at(PALETTE, spec.series.indexOf(o))) === (s.color ?? at(PALETTE, i))) ? [] : [{ key: `s:${s.name}`, label: s.name, color: s.color ?? at(PALETTE, i) }]))
    case "bars": {
      const used = [...new Set(spec.colors ?? [at(PALETTE, 0)])]
      return used.map((c, i) => ({ key: `c:${c}`, label: spec.legend?.find((l) => l.color === c)?.name ?? (used.length === 1 ? "Bars" : `Color ${i + 1}`), color: c }))
    }
    default:
      return []
  }
}

/** Returns a copy of the spec with theme + overrides written into its explicit color fields. */
export function applyColors(spec: ChartSpec, themeName: string | undefined, overrides: Record<string, string> | undefined): ChartSpec {
  const theme = THEMES.find((t) => t.name === themeName)
  if (!theme && !overrides) return spec
  const ov = overrides ?? {}
  const pick = (key: string, i: number, current: string) => ov[key] ?? (theme && themeable(current) ? at(theme.colors, i) : current)

  switch (spec.kind) {
    case "column":
      return { ...spec, colors: spec.groups.map((g, i) => pick(`g:${g.name}`, i, spec.colors?.[i] ?? at(PALETTE, i))) }
    case "grouped":
      return { ...spec, colors: spec.series.map((s, i) => pick(`g:${s.name}`, i, spec.colors?.[i] ?? at(PALETTE, i))) }
    case "pie": {
      let k = 0
      return { ...spec, colors: spec.slices.map((s) => (s.value > 0 ? pick(`g:${s.label}`, k, spec.colors?.[k] ?? at(PALETTE, k++)) : "#ccc")) }
    }
    case "split":
      return { ...spec, colors: spec.sides.map((s, i) => pick(`g:${s}`, i, spec.colors?.[i] ?? at(PALETTE, i))) }
    case "xy": {
      // Visible series get theme colors in order; hidden helpers (fit lines) follow the series they share a color with.
      const original = spec.series.map((s, i) => s.color ?? at(PALETTE, i))
      const remap = new Map<string, string>()
      let k = 0
      const series = spec.series.map((s, i) => {
        if (s.hideInLegend) return s
        const next = pick(`s:${s.name}`, themeable(original[i]) ? k++ : k, original[i])
        if (!remap.has(original[i])) remap.set(original[i], next)
        return { ...s, color: next }
      })
      return { ...spec, series: series.map((s, i) => (s.hideInLegend ? { ...s, color: remap.get(original[i]) ?? original[i] } : s)) }
    }
    case "bars": {
      const base = spec.colors ?? spec.values.map(() => at(PALETTE, 0))
      const used = [...new Set(base)]
      const map = new Map(used.map((c, i) => [c, pick(`c:${c}`, i, c)]))
      return { ...spec, colors: base.map((c) => map.get(c) ?? c), legend: spec.legend?.map((l) => ({ ...l, color: map.get(l.color) ?? l.color })) }
    }
    default:
      return spec
  }
}
