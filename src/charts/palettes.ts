/** Color themes for series/groups, an extended swatch grid, and heatmap color scales. */
import { PALETTE } from "./scale"

export type Theme = { name: string; note?: string; colors: string[] }

export const THEMES: Theme[] = [
  { name: "Syvn Plot", note: "Default", colors: PALETTE },
  { name: "Okabe–Ito", note: "Colorblind safe", colors: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"] },
  { name: "Tol muted", note: "Colorblind safe", colors: ["#332288", "#88CCEE", "#44AA99", "#117733", "#999933", "#DDCC77", "#CC6677", "#882255", "#AA4499"] },
  { name: "Tol high contrast", note: "Colorblind + grayscale safe", colors: ["#004488", "#DDAA33", "#BB5566", "#000000"] },
  { name: "Classic", note: "Black first, Prism-like", colors: ["#1a1a1a", "#d62728", "#1f77b4", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b", "#e377c2"] },
  { name: "Grayscale", note: "Print / B&W journals", colors: ["#000000", "#5a5a5a", "#8c8c8c", "#b4b4b4", "#d6d6d6", "#2d2d2d", "#737373", "#c4c4c4"] },
  { name: "Nature (NPG)", note: "Journal style", colors: ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000", "#7E6148", "#B09C85"] },
  { name: "Science (AAAS)", note: "Journal style", colors: ["#3B4992", "#EE0000", "#008B45", "#631879", "#008280", "#BB0021", "#5F559B", "#A20056", "#808180", "#1B1919"] },
  { name: "Lancet", note: "Journal style", colors: ["#00468B", "#ED0000", "#42B540", "#0099B4", "#925E9F", "#FDAF91", "#AD002A", "#ADB6B6", "#1B1919"] },
  { name: "NEJM", note: "Journal style", colors: ["#BC3C29", "#0072B5", "#E18727", "#20854E", "#7876B1", "#6F99AD", "#FFDC91", "#EE4C97"] },
  { name: "JAMA", note: "Journal style", colors: ["#374E55", "#DF8F44", "#00A1D5", "#B24745", "#79AF97", "#6A6599", "#80796B"] },
  { name: "Cell", note: "Journal style", colors: ["#0B5394", "#E69138", "#6AA84F", "#CC0000", "#674EA7", "#45818E", "#BF9000", "#A64D79"] },
  { name: "Tableau 10", colors: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"] },
  { name: "Set 1", note: "Bold", colors: ["#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#FFFF33", "#A65628", "#F781BF", "#999999"] },
  { name: "Dark 2", colors: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"] },
  { name: "Paired", note: "Light/dark pairs", colors: ["#1F78B4", "#A6CEE3", "#33A02C", "#B2DF8A", "#E31A1C", "#FB9A99", "#FF7F00", "#FDBF6F", "#6A3D9A", "#CAB2D6"] },
  { name: "Pastel", colors: ["#A6CEE3", "#B2DF8A", "#FB9A99", "#FDBF6F", "#CAB2D6", "#FFED6F", "#B3DE69", "#BC80BD"] },
  { name: "Viridis", note: "Ordered groups (dose, time)", colors: ["#440154", "#46327E", "#365C8D", "#277F8E", "#1FA187", "#4AC16D", "#A0DA39", "#FDE725"] },
  { name: "Magma", note: "Ordered groups", colors: ["#1D1147", "#51127C", "#832681", "#B73779", "#E75263", "#FC8961", "#FEC287", "#FCFDBF"] },
  { name: "Cividis", note: "Ordered, colorblind safe", colors: ["#00204D", "#31446B", "#666970", "#958F78", "#CBBA69", "#FFEA46"] },
  { name: "Blues", note: "Dose series", colors: ["#08306B", "#08519C", "#2171B5", "#4292C6", "#6BAED6", "#9ECAE1", "#C6DBEF"] },
  { name: "Reds", note: "Dose series", colors: ["#67000D", "#A50F15", "#CB181D", "#EF3B2C", "#FB6A4A", "#FC9272", "#FCBBA1"] },
  { name: "Ocean", colors: ["#03045E", "#0077B6", "#00B4D8", "#90E0EF", "#023E8A", "#48CAE4", "#0096C7", "#ADE8F4"] },
  { name: "Sunset", colors: ["#F94144", "#F3722C", "#F8961E", "#F9C74F", "#90BE6D", "#43AA8B", "#577590", "#277DA1"] },
  { name: "Earth", colors: ["#5F4B32", "#A47148", "#D4A373", "#606C38", "#283618", "#BC6C25", "#DDA15E", "#8D99AE"] },
  { name: "Control vs treated", note: "Grey control, then colors", colors: ["#9AA0A6", "#2F6FDB", "#E0533D", "#2A9D6F", "#8A5CD1", "#E39B22"] },
]

/** 14 hues × 8 shades + grays: 122 swatches. */
export const SWATCHES: string[] = (() => {
  const hues = [0, 14, 28, 40, 52, 75, 120, 155, 180, 200, 215, 240, 270, 310]
  const lights = [90, 80, 68, 56, 46, 38, 30, 22]
  const out: string[] = []
  for (const l of lights) for (const h of hues) out.push(hslToHex(h, h === 52 || h === 75 ? 80 : 70, l))
  for (const g of [0, 20, 33, 46, 60, 73, 86, 93, 97, 100]) out.push(hslToHex(0, 0, g))
  return out
})()

function hslToHex(h: number, s: number, l: number) {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
}

export type ColorScale = { name: string; kind: "sequential" | "diverging"; stops: string[] }

export const COLOR_SCALES: ColorScale[] = [
  { name: "Blues", kind: "sequential", stops: ["#f1f6ff", "#c6dbef", "#6baed6", "#2171b5", "#123d8f"] },
  { name: "Viridis", kind: "sequential", stops: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"] },
  { name: "Magma", kind: "sequential", stops: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"] },
  { name: "Inferno", kind: "sequential", stops: ["#000004", "#56106e", "#bb3754", "#f98e09", "#fcffa4"] },
  { name: "Cividis", kind: "sequential", stops: ["#00204d", "#414d6b", "#7c7b78", "#bcaf6f", "#ffea46"] },
  { name: "Reds", kind: "sequential", stops: ["#fff5f0", "#fcbba1", "#fb6a4a", "#cb181d", "#67000d"] },
  { name: "Greens", kind: "sequential", stops: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"] },
  { name: "Purples", kind: "sequential", stops: ["#fcfbfd", "#dadaeb", "#9e9ac8", "#6a51a3", "#3f007d"] },
  { name: "Greys", kind: "sequential", stops: ["#ffffff", "#d9d9d9", "#969696", "#525252", "#000000"] },
  { name: "Yellow–Red", kind: "sequential", stops: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"] },
  { name: "Blue–White–Red", kind: "diverging", stops: ["#2f6fdb", "#9dbcf0", "#ffffff", "#f0a597", "#e0533d"] },
  { name: "Red–Yellow–Blue", kind: "diverging", stops: ["#4575b4", "#91bfdb", "#ffffbf", "#fc8d59", "#d73027"] },
  { name: "Purple–Green", kind: "diverging", stops: ["#762a83", "#c2a5cf", "#f7f7f7", "#a6dba0", "#1b7837"] },
  { name: "Brown–Teal", kind: "diverging", stops: ["#8c510a", "#dfc27d", "#f5f5f5", "#80cdc1", "#01665e"] },
  { name: "Cool–Warm", kind: "diverging", stops: ["#3b4cc0", "#8db0fe", "#dddddd", "#f49a7b", "#b40426"] },
  { name: "Green–Black–Red", kind: "diverging", stops: ["#00a000", "#006000", "#000000", "#800000", "#ff0000"] },
]

export const scaleByName = (name: string | undefined, kind: "sequential" | "diverging") => COLOR_SCALES.find((s) => s.name === name) ?? COLOR_SCALES.find((s) => s.kind === kind)!

/** Color at t∈[0,1] along a scale's stops. */
export function colorAt(stops: string[], t: number) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mixHex(stops[i], stops[i + 1], x - i)
}

export function mixHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`
}

/** True when white text reads better than black on this color. */
export function isDark(color: string) {
  const m = color.startsWith("#") ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : (color.match(/\d+/g) ?? ["255", "255", "255"]).slice(0, 3).map(Number)
  return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] < 140
}
