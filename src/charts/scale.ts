export const PALETTE = ["#2f6fdb", "#e0533d", "#2a9d6f", "#8a5cd1", "#e39b22", "#1fa3b5", "#c94c8a", "#6b7a1f", "#7a4a2a", "#4a5568", "#d1495b", "#3d8bd9"]
export const INK = "#1a1a1a"

/** Rounded axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    min -= Math.abs(min) * 0.5 || 1
    max += Math.abs(max) * 0.5 || 1
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)))
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)))
  return ticks
}

export function linear(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
}

export function tickLabel(v: number) {
  if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) return v.toExponential(1)
  return Number(v.toPrecision(6)).toLocaleString()
}

/** Deterministic jitter so dots don't move between renders. */
export function jitter(i: number, spread: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return (x - Math.floor(x) - 0.5) * spread
}

export function downloadSvg(svg: SVGSVGElement | null, name: string) {
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${name.replace(/[^\w.-]+/g, "_") || "graph"}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadPng(svg: SVGSVGElement | null, name: string) {
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  const { width, height } = svg.viewBox.baseVal
  const img = new Image()
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(clone.outerHTML)
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = width * 3
  canvas.height = height * 3
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const a = document.createElement("a")
  a.href = canvas.toDataURL("image/png")
  a.download = `${name.replace(/[^\w.-]+/g, "_") || "graph"}.png`
  a.click()
}

/** Y axis: linear nice ticks, or powers of ten when `log` is on. */
export function yAxis(lo: number, hi: number, log: boolean | undefined, r0: number, r1: number) {
  if (!log) {
    const ticks = niceTicks(lo, hi)
    return { ticks, map: linear(ticks[0], ticks[ticks.length - 1], r0, r1) }
  }
  const safeLo = lo > 0 ? lo : Math.max(hi / 1000, 1e-6)
  // Narrow ranges (< ~1.5 decades): 1-2-5 ticks instead of whole decades.
  if (Math.log10(Math.max(hi, safeLo)) - Math.log10(safeLo) < 1.5) {
    const series: number[] = []
    for (let e = Math.floor(Math.log10(safeLo)) - 1; e <= Math.ceil(Math.log10(Math.max(hi, safeLo))) + 1; e++) for (const m of [1, 2, 5]) series.push(Number((m * 10 ** e).toPrecision(6)))
    const a = [...series].reverse().find((t) => t <= safeLo) ?? series[0]
    const b = series.find((t) => t >= hi) ?? series[series.length - 1]
    const ticks = series.filter((t) => t >= a && t <= b)
    const toPx = linear(Math.log10(a), Math.log10(b), r0, r1)
    return { ticks, map: (v: number) => toPx(Math.log10(Math.max(v, a))) }
  }
  const e0 = Math.floor(Math.log10(safeLo))
  let e1 = Math.ceil(Math.log10(Math.max(hi, safeLo)))
  if (e1 === e0) e1 += 1
  const ticks = Array.from({ length: e1 - e0 + 1 }, (_, i) => 10 ** (e0 + i))
  const toPx = linear(e0, e1, r0, r1)
  return { ticks, map: (v: number) => toPx(Math.log10(Math.max(v, 10 ** e0))) }
}
