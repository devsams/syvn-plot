/**
 * Applies text edits and added labels to a rendered chart SVG (on screen and
 * in exports). Original text nodes are hidden, not removed, so React keeps
 * owning them; replacements are inserted next to them.
 */
import type { Annotation, Decor } from "../lib/specs"
import type { ChartSize } from "./size"

const SVG_NS = "http://www.w3.org/2000/svg"

export function decorateSvg(svg: SVGSVGElement, decor: Decor | undefined, size: ChartSize) {
  svg.querySelectorAll("[data-bp-clone]").forEach((n) => n.remove())
  svg.querySelectorAll("[data-bp-hidden]").forEach((n) => {
    ;(n as SVGElement).style.display = ""
    n.removeAttribute("data-bp-hidden")
  })
  svg.querySelector("g[data-bp-annotations]")?.remove()

  const renames = decor?.renames ?? {}
  if (Object.keys(renames).length) {
    svg.querySelectorAll("text").forEach((t) => {
      if (t.closest("[data-bp-annotations]") || t.closest("title")) return
      const original = t.textContent ?? ""
      if (!(original in renames)) return
      t.setAttribute("data-bp-hidden", original)
      t.style.display = "none"
      const value = renames[original]
      if (!value) return
      const clone = t.cloneNode(false) as SVGTextElement
      clone.removeAttribute("data-bp-hidden")
      clone.style.display = ""
      clone.setAttribute("data-bp-clone", original)
      clone.textContent = value
      t.after(clone)
    })
  }

  const anns = decor?.annotations ?? []
  if (anns.length) {
    const g = document.createElementNS(SVG_NS, "g")
    g.setAttribute("data-bp-annotations", "")
    for (const a of anns) g.appendChild(annotationNode(a, size))
    svg.appendChild(g)
  }
}

export function annotationNode(a: Annotation, size: ChartSize) {
  const t = document.createElementNS(SVG_NS, "text")
  t.setAttribute("x", String(a.fx * size.W))
  t.setAttribute("y", String(a.fy * size.H))
  t.setAttribute("font-size", String(a.size))
  t.setAttribute("fill", a.color)
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  if (a.bold) t.setAttribute("font-weight", "700")
  t.setAttribute("data-bp-ann", a.id)
  t.style.cursor = "move"
  t.textContent = a.text
  return t
}

/** The original (pre-edit) text of a clicked text element. */
export function originalText(t: Element) {
  return t.getAttribute("data-bp-clone") ?? t.getAttribute("data-bp-hidden") ?? t.textContent ?? ""
}
