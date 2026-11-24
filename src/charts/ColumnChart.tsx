import { forwardRef } from "react"

import type { ColumnChartSpec } from "../lib/specs"
import { fmtP, summarize } from "../lib/stats"
import { CategoryLabel, Note, Paper, YAxis, needsRotate } from "./frame"
import { useChartSize } from "./size"
import { INK, PALETTE, jitter, yAxis } from "./scale"

/** Prism-style column graph: bar + dots, scatter + mean, box, violin; optional before–after lines and significance brackets. */
export const ColumnChart = forwardRef<SVGSVGElement, { spec: ColumnChartSpec }>(function ColumnChart({ spec }, ref) {
  const { W, H, M } = useChartSize()
  const groups = spec.groups
  const stats = groups.map((g) => summarize(g.values))
  const errOf = (i: number) => {
    const s = stats[i]
    if (spec.error === "sem") return [s.mean - s.sem, s.mean + s.sem]
    if (spec.error === "ci") return [s.ciLow, s.ciHigh]
    return [s.mean - s.sd, s.mean + s.sd]
  }

  const brackets = bracketsToDraw(spec)
  const all = groups.flatMap((g) => g.values)
  const lows = [...all, ...groups.map((_, i) => errOf(i)[0]).filter(Number.isFinite)]
  const highs = [...all, ...groups.map((_, i) => errOf(i)[1]).filter(Number.isFinite)]
  let lo = Math.min(...lows)
  let hi = Math.max(...highs)
  if (spec.logY) {
    lo = Math.min(...all.filter((v) => v > 0))
    hi *= 1.15 // brackets get their own pixel band above the axis (below), not extra decades
  } else {
    if (spec.style === "bar") lo = Math.min(0, lo)
    const pad = (hi - lo) * 0.08 || 1
    if (spec.style !== "bar" || lo < 0) lo -= pad
    hi += pad * (1 + brackets.length * 1.6)
  }
  // Log axes: reserve a pixel band for the brackets instead of inflating the data range by decades.
  const bracketBand = spec.logY && brackets.length ? 16 + brackets.length * 20 : 0
  const { ticks, map: y } = yAxis(lo, hi, spec.logY, H - M.bottom, M.top + bracketBand)

  const plotW = W - M.left - M.right
  const band = plotW / Math.max(groups.length, 1)
  const cx = (i: number) => M.left + band * (i + 0.5)
  const barW = Math.min(band * 0.6, 70)
  const baseline = spec.style === "bar" && !spec.logY ? y(Math.max(ticks[0], 0)) : y(ticks[0])
  const jit = (k: number, i: number) => (spec.paired ? 0 : jitter(k + i * 97, Math.min(barW * 0.7, 40)))
  const rotate = needsRotate(groups.map((g) => g.name), band)

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={spec.title} fontFamily="Arial, Helvetica, sans-serif">
      <Paper title={spec.title} />
      <YAxis ticks={ticks} y={y} label={spec.yLabel} />
      <line x1={M.left} x2={W - M.right} y1={baseline} y2={baseline} stroke={INK} strokeWidth={1.5} />

      {spec.paired &&
        groups[0]?.values.slice(0, MAX_DOTS).map((_, k) => (
          <polyline key={`p${k}`} points={groups.map((g, i) => (Number.isFinite(g.values[k]) ? `${cx(i)},${y(g.values[k])}` : "")).join(" ")} fill="none" stroke="#9aa0a6" strokeWidth={1.2} />
        ))}

      {groups.map((g, i) => {
        const c = spec.colors?.[i] ?? PALETTE[i % PALETTE.length]
        const s = stats[i]
        const [eLo, eHi] = errOf(i)
        const x = cx(i)
        const hasData = s.n > 0
        const shown = g.values.length > MAX_DOTS ? g.values.filter((_, k) => k % Math.ceil(g.values.length / MAX_DOTS) === 0) : g.values
        const dots = shown.map((v, k) => (
          <circle key={k} cx={x + jit(k, i)} cy={y(v)} r={3.6} fill={spec.style === "bar" ? "#fff" : c} stroke={spec.style === "bar" ? INK : "none"} strokeWidth={1} opacity={spec.style === "box" || spec.style === "violin" ? 0.55 : 1} />
        ))
        return (
          <g key={g.name + i}>
            {hasData && spec.style === "bar" && (
              <>
                <rect x={x - barW / 2} width={barW} y={Math.min(y(s.mean), baseline)} height={Math.abs(baseline - y(s.mean))} fill={c} fillOpacity={0.85} stroke={INK} strokeWidth={1.5} />
                {s.n > 1 && <ErrorBar x={x} y0={y(eLo)} y1={y(eHi)} w={barW * 0.35} />}
                {dots}
              </>
            )}
            {hasData && spec.style === "scatter" && (
              <>
                {dots}
                <line x1={x - barW * 0.45} x2={x + barW * 0.45} y1={y(s.mean)} y2={y(s.mean)} stroke={INK} strokeWidth={2.5} />
                {s.n > 1 && <ErrorBar x={x} y0={y(eLo)} y1={y(eHi)} w={barW * 0.3} />}
              </>
            )}
            {hasData && spec.style === "box" && (
              <>
                <line x1={x} x2={x} y1={y(s.min)} y2={y(s.q1)} stroke={INK} strokeWidth={1.5} />
                <line x1={x} x2={x} y1={y(s.q3)} y2={y(s.max)} stroke={INK} strokeWidth={1.5} />
                <line x1={x - barW * 0.25} x2={x + barW * 0.25} y1={y(s.min)} y2={y(s.min)} stroke={INK} strokeWidth={1.5} />
                <line x1={x - barW * 0.25} x2={x + barW * 0.25} y1={y(s.max)} y2={y(s.max)} stroke={INK} strokeWidth={1.5} />
                <rect x={x - barW / 2} width={barW} y={y(s.q3)} height={Math.max(1, y(s.q1) - y(s.q3))} fill={c} fillOpacity={0.35} stroke={INK} strokeWidth={1.5} />
                <line x1={x - barW / 2} x2={x + barW / 2} y1={y(s.median)} y2={y(s.median)} stroke={INK} strokeWidth={2.5} />
                {dots}
              </>
            )}
            {hasData && spec.style === "violin" && (
              <>
                <path d={violinPath(g.values, x, barW / 2, y, ticks)} fill={c} fillOpacity={0.35} stroke={INK} strokeWidth={1.5} />
                <line x1={x - barW * 0.3} x2={x + barW * 0.3} y1={y(s.median)} y2={y(s.median)} stroke={INK} strokeWidth={2.5} />
                <line x1={x - barW * 0.18} x2={x + barW * 0.18} y1={y(s.q1)} y2={y(s.q1)} stroke={INK} strokeWidth={1.2} strokeDasharray="3 2" />
                <line x1={x - barW * 0.18} x2={x + barW * 0.18} y1={y(s.q3)} y2={y(s.q3)} stroke={INK} strokeWidth={1.2} strokeDasharray="3 2" />
                {dots}
              </>
            )}
            <line x1={x} x2={x} y1={baseline} y2={baseline + 6} stroke={INK} strokeWidth={1.5} />
            <CategoryLabel x={x} y={baseline + 12} text={g.name} rotate={rotate} />
          </g>
        )
      })}

      {brackets.map((b, level) => {
        const top = (bracketBand ? M.top : y(ticks[ticks.length - 1])) + 16 + level * 20
        return (
          <g key={`${b.a}-${b.b}`}>
            <path d={`M${cx(b.a)} ${top + 7} V${top} H${cx(b.b)} V${top + 7}`} fill="none" stroke={INK} strokeWidth={1.3} />
            <text x={(cx(b.a) + cx(b.b)) / 2} y={top - 3} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>
              {b.summary}
            </text>
          </g>
        )
      })}
      <Note text={spec.test ? `${spec.test.name}: P ${spec.test.p < 0.0001 ? "" : "= "}${fmtP(spec.test.p)} (${spec.test.summary})` : undefined} />
      <Note
        align="start"
        text={(spec.style === "box" ? "Box: median, IQR, min–max" : spec.style === "violin" ? "Violin: median & quartiles" : `Mean ± ${spec.error === "ci" ? "95% CI" : spec.error.toUpperCase()}`) + (groups.some((g) => g.values.length > MAX_DOTS) ? ` · dots: every nth value, max ${MAX_DOTS}/group` : "")}
      />
    </svg>
  )
})

const MAX_DOTS = 400

/** Two groups: the test itself. More: significant pairwise comparisons, shortest spans first, at most 5. */
function bracketsToDraw(spec: ColumnChartSpec) {
  if (spec.groups.length === 2 && spec.test) return [{ a: 0, b: 1, summary: spec.test.summary }]
  return (spec.comparisons ?? [])
    .filter((c) => c.p < 0.05)
    .sort((x, y) => x.b - x.a - (y.b - y.a) || x.a - y.a)
    .slice(0, 5)
}

function ErrorBar({ x, y0, y1, w }: { x: number; y0: number; y1: number; w: number }) {
  return (
    <g stroke={INK} strokeWidth={1.5}>
      <line x1={x} x2={x} y1={y0} y2={y1} />
      <line x1={x - w / 2} x2={x + w / 2} y1={y0} y2={y0} />
      <line x1={x - w / 2} x2={x + w / 2} y1={y1} y2={y1} />
    </g>
  )
}

function violinPath(values: number[], x: number, halfWidth: number, y: (v: number) => number, ticks: number[]) {
  const s = summarize(values)
  const bw = 1.06 * (s.sd || 1) * values.length ** -0.2
  const lo = Math.max(ticks[0], s.min - bw)
  const hi = Math.min(ticks[ticks.length - 1], s.max + bw)
  const steps = 40
  const pts: [number, number][] = []
  for (let k = 0; k <= steps; k++) {
    const v = lo + ((hi - lo) * k) / steps
    pts.push([v, values.reduce((acc, xi) => acc + Math.exp(-0.5 * ((v - xi) / bw) ** 2), 0)])
  }
  const maxD = Math.max(...pts.map((p) => p[1])) || 1
  const right = pts.map(([v, d]) => `${x + (d / maxD) * halfWidth},${y(v)}`)
  const left = [...pts].reverse().map(([v, d]) => `${x - (d / maxD) * halfWidth},${y(v)}`)
  return `M${right.join(" L")} L${left.join(" L")} Z`
}
