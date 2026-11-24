import { forwardRef } from "react"

import type { XYChartSpec } from "../lib/specs"
import { Legend, Note, Paper, YAxis, color } from "./frame"
import { useChartSize } from "./size"
import { INK, linear, niceTicks, tickLabel, yAxis } from "./scale"

/** One XY renderer for lines, symbols, error bars, step (survival), bars (histogram), fitted curves and reference lines. */
export const XYChart = forwardRef<SVGSVGElement, { spec: XYChartSpec }>(function XYChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const pts = spec.series.flatMap((s) => s.points)
  const xsAll = pts.map((p) => p.x).filter((v) => !spec.logX || v > 0)
  const ysAll = pts.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]).filter((v) => Number.isFinite(v) && (!spec.logY || v > 0))
  for (const r of spec.refLines ?? []) (r.axis === "x" ? xsAll : ysAll).push(r.value)
  const hasBars = spec.series.some((s) => s.mode === "bars")
  if (hasBars) ysAll.push(0)
  const halfBar = Math.max(0, ...spec.series.filter((s) => s.mode === "bars").map((s) => (s.barWidth ?? 0) / 2))

  const xMin = Math.min(...xsAll) - halfBar
  const xMax = Math.max(...xsAll) + halfBar
  let x: (v: number) => number
  let xTicks: number[]
  if (spec.logX) {
    const a = yAxis(xMin, xMax, true, M.left, W - M.right)
    x = a.map
    xTicks = a.ticks
  } else if (spec.xIsDate) {
    xTicks = Array.from({ length: 5 }, (_, i) => xMin + ((xMax - xMin || 86400000) * i) / 4)
    x = linear(xTicks[0], xTicks[4], M.left, W - M.right)
  } else {
    xTicks = niceTicks(xMin, xMax)
    x = linear(xTicks[0], xTicks[xTicks.length - 1], M.left, W - M.right)
  }
  const [yLo, yHi] = spec.yDomain ?? [Math.min(...ysAll), Math.max(...ysAll)]
  const { ticks: yTicks, map: y } = yAxis(yLo, yHi, spec.logY, H - M.bottom, M.top)
  const bottom = y(yTicks[0])
  const allLegend = spec.series.map((s, i) => ({ name: s.name, color: color(i, s.color), hide: s.hideInLegend })).filter((l) => !l.hide)
  const legend = allLegend.length > 12 ? [...allLegend.slice(0, 11), { name: `+${allLegend.length - 11} more`, color: "#bbb", hide: false }] : allLegend
  const dense = spec.series.some((s) => s.points.length > DENSITY_AT && (s.mode === "points" || s.mode === "line+points"))

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      <YAxis ticks={yTicks} y={y} label={spec.yLabel} />
      <line x1={M.left} x2={W - M.right} y1={bottom} y2={bottom} stroke={INK} strokeWidth={1.5} />
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={bottom} y2={bottom + 6} stroke={INK} strokeWidth={1.5} />
          <text x={x(t)} y={bottom + 20} textAnchor="middle" fontSize={12} fill={INK}>
            {spec.xIsDate ? new Date(t).toISOString().slice(0, 10) : tickLabel(t)}
          </text>
        </g>
      ))}
      <text x={(M.left + W - M.right) / 2} y={H - 14} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>
        {spec.xLabel}
      </text>

      {(spec.refLines ?? []).map((r, i) => (
        <g key={`r${i}`}>
          {r.axis === "y" ? (
            <line x1={M.left} x2={W - M.right} y1={y(r.value)} y2={y(r.value)} stroke="#888" strokeDasharray="4 4" />
          ) : (
            <line x1={x(r.value)} x2={x(r.value)} y1={M.top} y2={bottom} stroke="#888" strokeDasharray="4 4" />
          )}
          {r.label && (
            <text x={r.axis === "y" ? W - M.right - 2 : x(r.value) + 3} y={r.axis === "y" ? y(r.value) - 4 : M.top + 10} textAnchor={r.axis === "y" ? "end" : "start"} fontSize={10} fill="#666">
              {r.label}
            </text>
          )}
        </g>
      ))}

      {spec.series.map((s, i) => {
        const c = color(i, s.color)
        const visible = s.points.filter((p) => (!spec.logX || p.x > 0) && (!spec.logY || p.y > 0))
        const sorted = s.mode === "points" ? visible : [...visible].sort((a, b) => a.x - b.x)
        const path = sorted.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")
        const stepPath = sorted.map((p, k) => (k === 0 ? `M${x(p.x)},${y(p.y)}` : `H${x(p.x)} V${y(p.y)}`)).join(" ")
        return (
          <g key={s.name + i}>
            {s.mode === "bars" &&
              sorted.map((p, k) => {
                const w = s.barWidth ?? 1
                const [b0, b1] = p.bin ?? [p.x - w / 2, p.x + w / 2]
                const base = spec.logY ? bottom : y(0)
                return <rect key={k} x={x(b0)} width={Math.max(1, x(b1) - x(b0))} y={Math.min(y(p.y), base)} height={Math.abs(base - y(p.y))} fill={c} fillOpacity={0.75} stroke={sorted.length > 80 ? "none" : INK} strokeWidth={1} />
              })}
            {(s.mode === "line" || s.mode === "line+points") && <polyline points={path} fill="none" stroke={c} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} />}
            {s.mode === "step" && <path d={stepPath} fill="none" stroke={c} strokeWidth={2} />}
            {sorted.map((p, k) =>
              p.lo !== undefined && p.hi !== undefined ? (
                <g key={`e${k}`} stroke={c} strokeWidth={1.3}>
                  <line x1={x(p.x)} x2={x(p.x)} y1={y(p.lo)} y2={y(p.hi)} />
                  <line x1={x(p.x) - 4} x2={x(p.x) + 4} y1={y(p.lo)} y2={y(p.lo)} />
                  <line x1={x(p.x) - 4} x2={x(p.x) + 4} y1={y(p.hi)} y2={y(p.hi)} />
                </g>
              ) : null,
            )}
            {(s.mode === "points" || (s.mode === "line+points" && sorted.length <= 150)) &&
              (sorted.length > DENSITY_AT ? (
                <Density points={sorted} x={x} y={y} color={c} />
              ) : (
                sorted.map((p, k) => <circle key={k} cx={x(p.x)} cy={y(p.y)} r={s.size ?? (sorted.length > 400 ? 2.2 : 3.5)} fill={c} stroke={sorted.length > 400 ? "none" : "#fff"} strokeWidth={0.6} opacity={sorted.length > 400 ? 0.6 : 1} />)
              ))}
            {(s.ticks ?? []).map((p, k) => (
              <line key={`t${k}`} x1={x(p.x)} x2={x(p.x)} y1={y(p.y) - 5} y2={y(p.y) + 5} stroke={c} strokeWidth={1.5} />
            ))}
            {sorted
              .filter((p) => p.label)
              .map((p, k) => (
                <text key={`l${k}`} x={x(p.x) + 5} y={y(p.y) - 5} fontSize={10} fill={INK}>
                  {p.label}
                </text>
              ))}
          </g>
        )
      })}
      <Legend items={legend} />
      <Note text={[spec.note, dense ? "Dense regions shaded by point count" : ""].filter(Boolean).join(" · ") || undefined} />
    </svg>
  )
})

const DENSITY_AT = 2500

/** Large point clouds (flow cytometry, single cells): a 2D histogram shaded by log count. */
function Density({ points, x, y, color: c }: { points: { x: number; y: number }[]; x: (v: number) => number; y: (v: number) => number; color: string }) {
  const cell = 4
  const bins = new Map<string, number>()
  for (const p of points) {
    const px = x(p.x)
    const py = y(p.y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue
    const key = `${Math.floor(px / cell)},${Math.floor(py / cell)}`
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  const max = Math.log1p(Math.max(1, ...bins.values()))
  return (
    <g>
      {[...bins.entries()].map(([key, n]) => {
        const [i, j] = key.split(",").map(Number)
        return <rect key={key} x={i * cell} y={j * cell} width={cell} height={cell} fill={c} opacity={0.15 + 0.85 * (Math.log1p(n) / max)} />
      })}
    </g>
  )
}
