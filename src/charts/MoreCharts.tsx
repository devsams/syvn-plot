import { forwardRef } from "react"

import type { BarsSpec, SplitViolinSpec } from "../lib/specs"
import { summarize } from "../lib/stats"
import { CategoryLabel, Legend, Note, Paper, YAxis, color , needsRotate } from "./frame"
import { useChartSize } from "./size"
import { INK, jitter, linear, tickLabel, yAxis } from "./scale"
import { arrMin, arrMax } from "../lib/minmax"

/** One bar or point (with optional CI) per label; vertical (waterfall) or horizontal (ranked bars, forest plot). */
export const BarsChart = forwardRef<SVGSVGElement, { spec: BarsSpec }>(function BarsChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const n = spec.labels.length
  const vals = [...spec.values, ...(spec.lo ?? []), ...(spec.hi ?? []), ...(spec.refLines ?? []).map((r) => r.value)].filter((v): v is number => v !== null && Number.isFinite(v) && (!spec.logScale || v > 0))
  let lo = arrMin([...vals])
  let hi = arrMax([...vals])
  if (spec.mark === "bar" && !spec.logScale) {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  const pad = spec.logScale ? 0 : (hi - lo) * 0.05
  const horizontal = spec.orientation === "horizontal"
  const longest = arrMax([...spec.labels.map((l) => Math.min(l.length, 34))])
  const left = horizontal ? Math.min(230, 16 + longest * 6.2) : M.left
  const top = M.top + (spec.legend && spec.legend.length > 1 ? 12 : 0)
  const axis = horizontal ? yAxis(lo - pad, hi + pad, spec.logScale, left, W - M.right) : yAxis(lo - pad, hi + pad, spec.logScale, H - M.bottom, top)
  const v = axis.map
  const ticks = axis.ticks
  const zero = spec.logScale ? (spec.refLines?.[0] ? v(spec.refLines[0].value) : v(ticks[0])) : v(Math.max(ticks[0], Math.min(0, ticks[ticks.length - 1])))
  const band = horizontal ? (H - top - 50) / Math.max(n, 1) : (W - M.left - M.right) / Math.max(n, 1)
  const pos = (i: number) => (horizontal ? top + band * (i + 0.5) : M.left + band * (i + 0.5))
  const thick = Math.max(1, Math.min(band * 0.75, 40))
  const showLabels = band >= 9

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      {horizontal ? (
        <g>
          <line x1={left} x2={W - M.right} y1={H - 46} y2={H - 46} stroke={INK} strokeWidth={1.5} />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={v(t)} x2={v(t)} y1={H - 46} y2={H - 40} stroke={INK} strokeWidth={1.5} />
              <text x={v(t)} y={H - 28} textAnchor="middle" fontSize={12} fill={INK}>{tickLabel(t)}</text>
            </g>
          ))}
          <text x={(left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>{spec.valueLabel}</text>
        </g>
      ) : (
        <YAxis ticks={ticks} y={v} label={spec.valueLabel} />
      )}
      {(spec.refLines ?? []).map((r, i) =>
        horizontal ? (
          <g key={i}>
            <line x1={v(r.value)} x2={v(r.value)} y1={top - 6} y2={H - 46} stroke="#777" strokeDasharray="4 4" />
            {r.label && <text x={v(r.value) + 3} y={top - 8} fontSize={10} fill="#666">{r.label}</text>}
          </g>
        ) : (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={v(r.value)} y2={v(r.value)} stroke="#777" strokeDasharray="4 4" />
            {r.label && <text x={W - M.right - 2} y={v(r.value) - 4} textAnchor="end" fontSize={10} fill="#666">{r.label}</text>}
          </g>
        ),
      )}
      {spec.values.map((val, i) => {
        const c = spec.colors?.[i] ?? color(0)
        const p = pos(i)
        const lo_ = spec.lo?.[i]
        const hi_ = spec.hi?.[i]
        const hasCI = lo_ != null && hi_ != null && Number.isFinite(lo_) && Number.isFinite(hi_)
        return (
          <g key={i}>
            {spec.mark === "bar" &&
              (horizontal ? (
                <rect x={Math.min(zero, v(val))} y={p - thick / 2} width={Math.abs(v(val) - zero)} height={thick} fill={c} stroke={n <= 60 ? INK : "none"} strokeWidth={0.8} />
              ) : (
                <rect x={p - thick / 2} y={Math.min(zero, v(val))} width={thick} height={Math.abs(v(val) - zero)} fill={c} stroke={n <= 60 ? INK : "none"} strokeWidth={0.8} />
              ))}
            {hasCI &&
              (horizontal ? (
                <g stroke={INK} strokeWidth={1.4}>
                  <line x1={v(lo_!)} x2={v(hi_!)} y1={p} y2={p} />
                  <line x1={v(lo_!)} x2={v(lo_!)} y1={p - 4} y2={p + 4} />
                  <line x1={v(hi_!)} x2={v(hi_!)} y1={p - 4} y2={p + 4} />
                </g>
              ) : (
                <g stroke={INK} strokeWidth={1.4}>
                  <line x1={p} x2={p} y1={v(lo_!)} y2={v(hi_!)} />
                  <line x1={p - 4} x2={p + 4} y1={v(lo_!)} y2={v(lo_!)} />
                  <line x1={p - 4} x2={p + 4} y1={v(hi_!)} y2={v(hi_!)} />
                </g>
              ))}
            {spec.mark === "point" && (horizontal ? <rect x={v(val) - 4.5} y={p - 4.5} width={9} height={9} fill={c} stroke={INK} /> : <circle cx={p} cy={v(val)} r={4.5} fill={c} stroke={INK} />)}
            {showLabels &&
              (horizontal ? (
                <text x={left - 6} y={p} textAnchor="end" dominantBaseline="middle" fontSize={Math.min(12, band * 0.8)} fill={INK}>
                  {spec.labels[i].length > 34 ? spec.labels[i].slice(0, 33) + "…" : spec.labels[i]}
                </text>
              ) : n <= 30 ? (
                <CategoryLabel x={p} y={H - M.bottom + 8} text={spec.labels[i]} rotate={needsRotate(spec.labels, band)} />
              ) : null)}
          </g>
        )
      })}
      {spec.legend && <Legend items={spec.legend} />}
      <Note text={spec.note} />
    </svg>
  )
})

/** Split violin: left half = first side, right half = second side, per category. */
export const SplitViolinChart = forwardRef<SVGSVGElement, { spec: SplitViolinSpec }>(function SplitViolinChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const all = spec.values.flat(2)
  const s = summarize(all)
  const pad = (s.max - s.min) * 0.08 || 1
  const { ticks, map: y } = yAxis(s.min - pad, s.max + pad, false, H - M.bottom, M.top)
  const band = (W - M.left - M.right) / Math.max(spec.categories.length, 1)
  const half = Math.min(band * 0.42, 60)
  const kde = (vals: number[]) => {
    const st = summarize(vals)
    const bw = 1.06 * (st.sd || 1) * Math.max(vals.length, 2) ** -0.2
    const lo = Math.max(ticks[0], st.min - bw)
    const hi = Math.min(ticks[ticks.length - 1], st.max + bw)
    const pts = Array.from({ length: 41 }, (_, k) => {
      const t = lo + ((hi - lo) * k) / 40
      return [t, vals.reduce((a, x) => a + Math.exp(-0.5 * ((t - x) / bw) ** 2), 0)] as const
    })
    return { pts, st }
  }
  const maxD = arrMax([1e-12, ...spec.values.flatMap((side) => side.filter((v) => v.length).map((v) => arrMax(kde(v).pts.map((p) => p[1])) / v.length))])
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      <YAxis ticks={ticks} y={y} label={spec.yLabel} />
      <line x1={M.left} x2={W - M.right} y1={y(ticks[0])} y2={y(ticks[0])} stroke={INK} strokeWidth={1.5} />
      {spec.categories.map((cat, ci) => {
        const cx = M.left + band * (ci + 0.5)
        return (
          <g key={cat + ci}>
            {[0, 1].map((side) => {
              const vals = spec.values[side as 0 | 1][ci] ?? []
              if (!vals.length) return null
              const { pts, st } = kde(vals)
              const dir = side === 0 ? -1 : 1
              const w = (d: number) => (d / vals.length / maxD) * half
              const d = `M${cx},${y(pts[0][0])} ` + pts.map(([t, dd]) => `L${cx + dir * w(dd)},${y(t)}`).join(" ") + ` L${cx},${y(pts[pts.length - 1][0])} Z`
              const shown = vals.length > 300 ? vals.filter((_, k) => k % Math.ceil(vals.length / 300) === 0) : vals
              return (
                <g key={side}>
                  <path d={d} fill={spec.colors?.[side] ?? color(side)} fillOpacity={0.45} stroke={INK} strokeWidth={1.2} />
                  <line x1={cx} x2={cx + dir * half * 0.6} y1={y(st.median)} y2={y(st.median)} stroke={INK} strokeWidth={2.2} />
                  {shown.map((v, k) => (
                    <circle key={k} cx={cx + dir * (half * 0.15 + Math.abs(jitter(k + side * 51 + ci * 13, half * 0.3)))} cy={y(v)} r={1.8} fill={spec.colors?.[side] ?? color(side)} opacity={0.6} />
                  ))}
                </g>
              )
            })}
            <CategoryLabel x={cx} y={y(ticks[0]) + 10} text={cat} rotate={needsRotate(spec.categories, band)} />
          </g>
        )
      })}
      <Legend items={spec.sides.map((s2, i) => ({ name: s2, color: spec.colors?.[i] ?? color(i) }))} />
      <Note text={spec.note ?? "Line = median"} />
    </svg>
  )
})

export { linear }
