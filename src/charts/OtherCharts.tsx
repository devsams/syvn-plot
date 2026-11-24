import { forwardRef } from "react"

import type { GroupedChartSpec, HeatmapSpec, PieSpec } from "../lib/specs"
import { fmt } from "../lib/stats"
import { CategoryLabel, Legend, Note, Paper, YAxis, color , needsRotate } from "./frame"
import { useChartSize } from "./size"
import { colorAt, isDark, scaleByName } from "./palettes"
import { INK, jitter, yAxis } from "./scale"
import { arrMin, arrMax } from "../lib/minmax"

/** Grouped or stacked bars: categories on X, one bar per series. */
export const GroupedChart = forwardRef<SVGSVGElement, { spec: GroupedChartSpec }>(function GroupedChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const nCat = spec.categories.length
  const nSer = spec.series.length
  const stacked = spec.mode !== "grouped"
  const totals = spec.categories.map((_, c) => spec.series.reduce((s, ser) => s + Math.max(0, ser.values[c] ?? 0), 0))
  const val = (s: number, c: number) => {
    const v = spec.series[s].values[c] ?? 0
    return spec.mode === "percent" ? (totals[c] ? (100 * v) / totals[c] : 0) : v
  }

  let hi = 0
  let lo = 0
  if (stacked) hi = spec.mode === "percent" ? 100 : arrMax([...totals])
  else
    spec.series.forEach((ser, s) =>
      ser.values.forEach((v, c) => {
        const top = (v ?? 0) + (ser.err?.[c] ?? 0)
        const pts = ser.points?.[c] ?? []
        hi = arrMax([hi, top, ...pts])
        lo = arrMin([lo, val(s, c), ...pts])
      }),
    )
  if (spec.refLine !== undefined) hi = Math.max(hi, spec.refLine)
  const logPos = spec.series.flatMap((s) => [...s.values, ...(s.points ?? []).flat()]).filter((v): v is number => v !== null && v > 0)
  const { ticks, map: y } = yAxis(spec.logY ? arrMin([...logPos]) : lo, spec.logY ? hi * 1.3 : hi * 1.05, spec.logY, H - M.bottom, M.top)
  const base = spec.logY ? y(ticks[0]) : y(Math.max(0, ticks[0]))
  const band = (W - M.left - M.right) / Math.max(nCat, 1)
  const barW = stacked ? Math.min(band * 0.6, 70) : Math.min((band * 0.8) / Math.max(nSer, 1), 40)

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      <YAxis ticks={ticks} y={y} label={spec.mode === "percent" ? `% of ${spec.yLabel}` : spec.yLabel} />
      <line x1={M.left} x2={W - M.right} y1={base} y2={base} stroke={INK} strokeWidth={1.5} />
      {spec.refLine !== undefined && <line x1={M.left} x2={W - M.right} y1={y(spec.refLine)} y2={y(spec.refLine)} stroke="#888" strokeDasharray="4 4" />}
      {spec.categories.map((cat, c) => {
        const center = M.left + band * (c + 0.5)
        let acc = 0
        return (
          <g key={cat + c}>
            {spec.series.map((ser, s) => {
              const v = val(s, c)
              if (ser.values[c] === null) return null
              if (stacked) {
                const y0 = y(acc)
                acc += v
                return <rect key={s} x={center - barW / 2} width={barW} y={y(acc)} height={Math.max(0, y0 - y(acc))} fill={spec.colors?.[s] ?? color(s)} stroke={INK} strokeWidth={1} />
              }
              const bx = center - (nSer * barW) / 2 + s * barW + barW / 2
              const err = ser.err?.[c]
              return (
                <g key={s}>
                  <rect x={bx - barW / 2 + 1} width={barW - 2} y={Math.min(y(v), base)} height={Math.abs(base - y(v))} fill={spec.colors?.[s] ?? color(s)} fillOpacity={0.85} stroke={INK} strokeWidth={1.2} />
                  {err ? (
                    <g stroke={INK} strokeWidth={1.3}>
                      <line x1={bx} x2={bx} y1={y(v - err)} y2={y(v + err)} />
                      <line x1={bx - barW * 0.2} x2={bx + barW * 0.2} y1={y(v + err)} y2={y(v + err)} />
                      <line x1={bx - barW * 0.2} x2={bx + barW * 0.2} y1={y(v - err)} y2={y(v - err)} />
                    </g>
                  ) : null}
                  {(ser.points?.[c] ?? []).map((p, k) => (
                    <circle key={k} cx={bx + jitter(k + s * 31 + c * 7, barW * 0.5)} cy={y(p)} r={2.8} fill="#fff" stroke={INK} strokeWidth={0.9} />
                  ))}
                </g>
              )
            })}
            <CategoryLabel x={center} y={base + 10} text={cat} rotate={needsRotate(spec.categories, band)} />
          </g>
        )
      })}
      <Legend items={spec.series.map((s, i) => ({ name: s.name, color: spec.colors?.[i] ?? color(i) }))} />
      <Note text={spec.note} />
    </svg>
  )
})

/** Heatmap for plates and correlation matrices. */
export const Heatmap = forwardRef<SVGSVGElement, { spec: HeatmapSpec }>(function Heatmap({ spec }, ref) {
  const { W, H } = useChartSize()
  const nr = spec.rows.length
  const nc = spec.cols.length
  const flat = spec.values.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  const [d0, d1] = spec.domain ?? (spec.scale === "diverging" ? [-arrMax([...flat.map(Math.abs)]), arrMax([...flat.map(Math.abs)])] : [arrMin([...flat]), arrMax([...flat])])
  const longest = arrMax([...spec.cols.map((c) => Math.min(c.length, 12))])
  const left = Math.min(110, 14 + 6.5 * arrMax(spec.rows.map((r) => Math.min(r.length, 12))))
  const right = 70
  const fit0 = Math.min((W - left - right) / nc, (H - 64) / nr)
  const rotateCols = longest * 6.5 > fit0
  const top = rotateCols ? 14 + longest * 4.8 : 34
  const cellW = Math.min((W - left - right) / nc, Math.max(14, (H - top - 16) / nr) * 3)
  const cellH = Math.min((H - top - 16) / nr, cellW)
  const cell = Math.min(cellW, cellH)
  const scale = scaleByName(spec.colorScale, spec.scale)
  const fill = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "#eee"
    return colorAt(scale.stops, (v - d0) / (d1 - d0 || 1))
  }
  const darkText = (v: number | null) => v === null || !isDark(fill(v))
  const legendH = Math.max(60, nr * cellH)
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      {spec.cols.map((c, j) => (
        <text key={`c${j}`} transform={`translate(${left + cellW * (j + 0.5)} ${top - 6}) rotate(${rotateCols ? -40 : 0})`} textAnchor={rotateCols ? "start" : "middle"} fontSize={Math.min(12, cell * 0.45)} fill={INK}>
          {c.length > 12 ? c.slice(0, 11) + "…" : c}
        </text>
      ))}
      {spec.rows.map((r, i) => (
        cellH >= 7 && <text key={`r${i}`} x={left - 6} y={top + cellH * (i + 0.5)} textAnchor="end" dominantBaseline="middle" fontSize={Math.min(12, cellH * 0.8)} fill={INK}>
          {r.length > 12 ? r.slice(0, 11) + "…" : r}
        </text>
      ))}
      {spec.values.map((row, i) =>
        row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={left + cellW * j} y={top + cellH * i} width={Math.max(0.5, cellW - (cellW > 6 ? 1 : 0))} height={Math.max(0.5, cellH - (cellH > 6 ? 1 : 0))} fill={fill(v)} />
            {spec.showValues && v !== null && cell > 22 && (
              <text x={left + cellW * (j + 0.5)} y={top + cellH * (i + 0.5)} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(11, cell * 0.3)} fill={darkText(v) ? INK : "#fff"}>
                {fmt(v, 2)}
              </text>
            )}
          </g>
        )),
      )}
      <defs>
        <linearGradient id={`g-${scale.name.replace(/\W/g, "")}`} x1="0" x2="0" y1="1" y2="0">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <stop key={t} offset={t} stopColor={fill(d0 + t * (d1 - d0))} />
          ))}
        </linearGradient>
      </defs>
      <rect x={left + cellW * nc + 14} y={top} width={12} height={legendH} fill={`url(#g-${scale.name.replace(/\W/g, "")})`} stroke="#ccc" />
      <text x={left + cellW * nc + 30} y={top + 8} fontSize={10} fill={INK}>{fmt(d1, 2)}</text>
      <text x={left + cellW * nc + 30} y={top + legendH} fontSize={10} fill={INK}>{fmt(d0, 2)}</text>
      {spec.legendLabel && (
        <text x={left + cellW * nc + 30} y={top + legendH / 2} fontSize={10} fill="#555">{spec.legendLabel}</text>
      )}
    </svg>
  )
})

/** Pie / donut for parts of a whole. */
export const PieChart = forwardRef<SVGSVGElement, { spec: PieSpec }>(function PieChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const slices = spec.slices.filter((s) => s.value > 0)
  const total = slices.reduce((s, v) => s + v.value, 0) || 1
  const cx = 190
  const cy = H / 2 + 6
  const r = 130
  let angle = -Math.PI / 2
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      {slices.map((s, i) => {
        const a0 = angle
        const a1 = angle + (2 * Math.PI * s.value) / total
        angle = a1
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
        const inner = spec.donut ? r * 0.55 : 0
        const d = slices.length === 1 ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0` : spec.donut ? `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)} Z` : `M${cx},${cy} L${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} Z`
        const mid = (a0 + a1) / 2
        const pct = (100 * s.value) / total
        return (
          <g key={s.label + i}>
            <path d={d} fill={spec.colors?.[i] ?? color(i)} stroke="#fff" strokeWidth={1.5} />
            {pct >= 4 && (
              <text x={cx + r * (spec.donut ? 0.78 : 0.65) * Math.cos(mid)} y={cy + r * (spec.donut ? 0.78 : 0.65) * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">
                {pct.toFixed(pct < 10 ? 1 : 0)}%
              </text>
            )}
          </g>
        )
      })}
      {slices.map((s, i) => (
        <g key={`l${i}`} transform={`translate(350 ${60 + i * 20})`}>
          <rect width={12} height={12} y={-6} fill={spec.colors?.[i] ?? color(i)} />
          <text x={18} dominantBaseline="middle" fontSize={12} fill={INK}>
            {(s.label.length > 18 ? s.label.slice(0, 17) + "…" : s.label) + ` (${fmt(s.value)})`}
          </text>
        </g>
      ))}
      <Legend items={[]} />
      <text x={M.left} y={14} fontSize={11} fill="#555">Total = {fmt(total)}</text>
    </svg>
  )
})

