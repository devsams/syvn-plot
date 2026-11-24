import { INK, PALETTE, tickLabel } from "./scale"

import { useChartSize } from "./size"

export function Paper({ title }: { title: string }) {
  const { W, H } = useChartSize()
  return (
    <>
      <title>{title}</title>
      <rect width={W} height={H} fill="#fff" />
    </>
  )
}

export function YAxis({ ticks, y, label, x0: x0Prop }: { ticks: number[]; y: (v: number) => number; label: string; x0?: number }) {
  const { H, M } = useChartSize()
  const x0 = x0Prop ?? M.left
  return (
    <g>
      <line x1={x0} x2={x0} y1={y(ticks[0])} y2={y(ticks[ticks.length - 1])} stroke={INK} strokeWidth={1.5} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x0 - 6} x2={x0} y1={y(t)} y2={y(t)} stroke={INK} strokeWidth={1.5} />
          <text x={x0 - 9} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill={INK}>
            {tickLabel(t)}
          </text>
        </g>
      ))}
      <text transform={`translate(18 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>
        {label.length > 40 ? label.slice(0, 39) + "…" : label}
      </text>
    </g>
  )
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  const { W, M } = useChartSize()
  if (items.length < 2) return null
  const perRow = Math.max(2, Math.floor((W - M.left - 20) / 108))
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.name + i} transform={`translate(${M.left + 8 + (i % perRow) * 108} ${M.top - 18 + Math.floor(i / perRow) * 13})`}>
          <rect width={10} height={10} y={-5} fill={it.color} />
          <text x={14} dominantBaseline="middle" fontSize={11} fill={INK}>
            {it.name.length > 14 ? it.name.slice(0, 13) + "…" : it.name}
          </text>
        </g>
      ))}
    </g>
  )
}

export function Note({ text, align = "end" }: { text?: string; align?: "start" | "end" }) {
  const { W, M } = useChartSize()
  if (!text) return null
  const narrow = W < 500
  return (
    <text x={align === "end" ? W - M.right : M.left} y={narrow && align === "start" ? 27 : 14} textAnchor={align} fontSize={11} fill="#555">
      {text.length > 90 ? text.slice(0, 89) + "…" : text}
    </text>
  )
}

export const color = (i: number, override?: string) => override ?? PALETTE[i % PALETTE.length]

export function CategoryLabel({ x, y, text, rotate }: { x: number; y: number; text: string; rotate: boolean }) {
  return (
    <text transform={`translate(${x} ${y}) rotate(${rotate ? -35 : 0})`} textAnchor={rotate ? "end" : "middle"} dominantBaseline="hanging" fontSize={12.5} fontWeight={600} fill={INK}>
      {text.length > 16 ? text.slice(0, 15) + "…" : text}
    </text>
  )
}

/** Rotate category labels when they would not fit side by side. */
export const needsRotate = (labels: string[], band: number) => labels.length > 8 || Math.max(0, ...labels.map((l) => Math.min(l.length, 16))) * 6.8 > band - 4
