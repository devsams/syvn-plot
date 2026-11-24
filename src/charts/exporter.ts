/**
 * Export a chart at a chosen size: re-renders the chart with that canvas
 * (so text stays the right size instead of being stretched), applies text
 * edits and added labels, then writes SVG, PNG at a given DPI, or a vector PDF
 * with an embedded Arial-metric font (Arimo) so µ, Δ, ≥, ′ print correctly.
 */
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { ChartSpec } from "../lib/specs"
import { ChartRenderer } from "./ChartRenderer"
import { decorateSvg } from "./decorate"
import { SizeContext, makeSize, type SizePreset } from "./size"

export type ExportFormat = "pdf" | "svg" | "png150" | "png300" | "png600"

export const FORMATS: { id: ExportFormat; label: string; use: string }[] = [
  { id: "pdf", label: "PDF (vector)", use: "Journal submission, Illustrator, printing" },
  { id: "svg", label: "SVG (vector)", use: "Edit in Illustrator / Inkscape / Figma" },
  { id: "png300", label: "PNG 300 dpi", use: "Uploads, Word, most journals' raster minimum" },
  { id: "png600", label: "PNG 600 dpi", use: "Line art / high-resolution figures" },
  { id: "png150", label: "PNG 150 dpi", use: "Slides, web, email" },
]

/** Renders the chart at the preset's layout and returns a detached, decorated SVG element. */
export function buildSvg(spec: ChartSpec, preset: SizePreset) {
  const size = makeSize(preset.W, preset.H)
  const markup = renderToStaticMarkup(createElement(SizeContext.Provider, { value: size }, createElement(ChartRenderer, { spec })))
  const doc = new DOMParser().parseFromString(markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'), "image/svg+xml")
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement
  // Attach off-screen so text measures and computed styles work.
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:" + preset.W + "px"
  host.appendChild(svg)
  document.body.appendChild(host)
  decorateSvg(svg, spec.decor, size)
  // Clean export: drop hidden originals and helper attributes.
  svg.querySelectorAll("[data-bp-hidden]").forEach((n) => n.remove())
  svg.querySelectorAll("[data-bp-clone],[data-bp-ann]").forEach((n) => {
    n.removeAttribute("data-bp-clone")
    n.removeAttribute("data-bp-ann")
    ;(n as SVGElement).style.cursor = ""
  })
  svg.removeAttribute("class")
  svg.setAttribute("width", `${preset.width}${preset.unit}`)
  svg.setAttribute("height", `${preset.height}${preset.unit}`)
  return { svg, cleanup: () => host.remove() }
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "graph"

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function exportChart(spec: ChartSpec, preset: SizePreset, format: ExportFormat) {
  const base = `${safeName(spec.title)}_${preset.id}`
  const { svg, cleanup } = buildSvg(spec, preset)
  try {
    if (format === "svg") {
      save(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }), `${base}.svg`)
      return
    }
    if (format === "pdf") {
      await savePdf(svg, preset, `${base}.pdf`)
      return
    }
    const dpi = format === "png600" ? 600 : format === "png150" ? 150 : 300
    const px =
      preset.unit === "px"
        ? { w: preset.width * (dpi >= 600 ? 2 : 1), h: preset.height * (dpi >= 600 ? 2 : 1) }
        : { w: Math.round((preset.width / 25.4) * dpi), h: Math.round((preset.height / 25.4) * dpi) }
    svg.setAttribute("width", String(px.w))
    svg.setAttribute("height", String(px.h))
    const img = new Image()
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg))
    await img.decode()
    const canvas = document.createElement("canvas")
    canvas.width = px.w
    canvas.height = px.h
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, px.w, px.h)
    ctx.drawImage(img, 0, 0, px.w, px.h)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"))
    if (blob) save(await withDpi(blob, dpi), `${base}_${dpi}dpi.png`)
  } finally {
    cleanup()
  }
}

let fontCache: Promise<[string, string]> | null = null
const toBase64 = async (url: string) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let s = ""
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

async function savePdf(svg: SVGSVGElement, preset: SizePreset, name: string) {
  const [{ jsPDF }] = await Promise.all([import("jspdf"), import("svg2pdf.js")])
  fontCache ??= Promise.all([toBase64(`${import.meta.env.BASE_URL}fonts/Arimo-Regular.ttf`), toBase64(`${import.meta.env.BASE_URL}fonts/Arimo-Bold.ttf`)])
  const [regular, bold] = await fontCache
  const unit = preset.unit === "mm" ? "mm" : "pt"
  const w = preset.unit === "mm" ? preset.width : preset.width * 0.75
  const h = preset.unit === "mm" ? preset.height : preset.height * 0.75
  const pdf = new jsPDF({ unit, format: [w, h], orientation: w > h ? "landscape" : "portrait" })
  pdf.addFileToVFS("Arimo-Regular.ttf", regular)
  pdf.addFont("Arimo-Regular.ttf", "Arimo", "normal")
  pdf.addFileToVFS("Arimo-Bold.ttf", bold)
  pdf.addFont("Arimo-Bold.ttf", "Arimo", "bold")
  svg.querySelectorAll("[font-family]").forEach((n) => n.setAttribute("font-family", "Arimo"))
  // svg2pdf ignores dominant-baseline: turn it into an explicit vertical offset.
  svg.querySelectorAll("[dominant-baseline]").forEach((n) => {
    const mode = n.getAttribute("dominant-baseline")
    let fsEl: Element | null = n
    while (fsEl && !fsEl.getAttribute("font-size")) fsEl = fsEl.parentElement
    const fs = Number(fsEl?.getAttribute("font-size") ?? 12)
    const shift = mode === "middle" || mode === "central" ? 0.35 * fs : mode === "hanging" ? 0.78 * fs : 0
    if (shift) n.setAttribute("dy", String(shift + Number(n.getAttribute("dy") ?? 0)))
    n.removeAttribute("dominant-baseline")
  })
  // Only regular and bold are embedded: map numeric weights (600 = semibold) onto them.
  svg.querySelectorAll("[font-weight]").forEach((n) => n.setAttribute("font-weight", Number(n.getAttribute("font-weight")) >= 600 || n.getAttribute("font-weight") === "bold" ? "bold" : "normal"))
  svg.setAttribute("font-family", "Arimo")
  await pdf.svg(svg, { x: 0, y: 0, width: w, height: h })
  pdf.setProperties({ title: name.replace(/\.pdf$/, ""), creator: "BenchPlot" })
  pdf.save(name)
}

/** Writes the DPI into the PNG (pHYs chunk) so Word/journals size it correctly. */
async function withDpi(blob: Blob, dpi: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4)
  view.setUint32(8, ppm)
  view.setUint32(12, ppm)
  chunk[16] = 1
  view.setUint32(17, crc32(chunk.subarray(4, 17)))
  // Insert right after IHDR (8-byte signature + 25-byte IHDR chunk).
  const out = new Uint8Array(bytes.length + 21)
  out.set(bytes.subarray(0, 33), 0)
  out.set(chunk, 33)
  out.set(bytes.subarray(33), 54)
  return new Blob([out], { type: "image/png" })
}

function crc32(data: Uint8Array) {
  let c = ~0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
