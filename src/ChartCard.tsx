import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import type { ChartEdits } from "./lib/graphSpec"
import { useEditApi } from "./research/context"
import { LabelField } from "./LabelField"
import { ChartRenderer } from "./charts/ChartRenderer"
import { colorItems, type ColorItem } from "./charts/colors"
import { decorateSvg, originalText } from "./charts/decorate"
import { exportChart, FORMATS, type ExportFormat } from "./charts/exporter"
import { COLOR_SCALES, SWATCHES, THEMES } from "./charts/palettes"
import { DEFAULT_SIZE, SIZE_PRESETS, SizeContext, makeSize, presetById } from "./charts/size"
import type { Annotation, ChartSpec } from "./lib/specs"

type Panel = "labels" | "colors" | "text" | null
type InlineEdit = { original: string; value: string; left: number; top: number; width: number; annId?: string }

/** One graph: toolbar (edit labels / colors / text, full screen, download) + the SVG. */
export function ChartCard({ spec, index }: { spec: ChartSpec; index?: number }) {
  const api = useEditApi()
  const ctx = index !== undefined && api ? api.get(index) : null
  const canEdit = !!ctx
  const [panel, setPanel] = useState<Panel>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [presetId, setPresetId] = useState("screen")
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [inline, setInline] = useState<InlineEdit | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)

  const preset = presetById(presetId)
  const size = fullscreen ? makeSize(preset.W, preset.H) : DEFAULT_SIZE

  // Apply text edits and added labels after every render (React owns the chart; we only add/hide nodes).
  useLayoutEffect(() => {
    if (svgRef.current) decorateSvg(svgRef.current, spec.decor, size)
  })

  const edits: ChartEdits = ctx?.edits ?? {}
  const save = useCallback((patch: ChartEdits) => index !== undefined && api?.edit("chart", index, patch), [api, index])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !inline && setFullscreen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreen, inline])

  // --- text editing -------------------------------------------------------------
  const openInline = (el: SVGTextElement, annId?: string) => {
    const stage = stageRef.current!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setInline({ original: annId ? "" : originalText(el), value: el.textContent ?? "", left: r.left - stage.left, top: r.top - stage.top - 4, width: Math.max(120, r.width + 40), annId })
  }

  const commitInline = (value: string) => {
    if (!inline) return
    if (inline.annId) {
      const anns = (edits.annotations ?? []).map((a) => (a.id === inline.annId ? { ...a, text: value } : a)).filter((a) => a.text.trim() !== "")
      save({ annotations: anns })
    } else {
      const renames = { ...(edits.renames ?? {}) }
      if (value === inline.original) delete renames[inline.original]
      else renames[inline.original] = value
      save({ renames })
    }
    setInline(null)
  }

  const toSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const m = svg.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (panel !== "text") return
    const t = (e.target as Element).closest("[data-sp-ann]") as SVGTextElement | null
    if (!t) return
    e.preventDefault()
    drag.current = { id: t.getAttribute("data-sp-ann")!, startX: e.clientX, startY: e.clientY, moved: false }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events have no capturable pointer */
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true
    const el = svgRef.current?.querySelector(`[data-sp-ann="${d.id}"]`)
    if (el && d.moved) {
      const p = toSvgPoint(e.clientX, e.clientY)
      el.setAttribute("x", String(p.x))
      el.setAttribute("y", String(p.y))
    }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const el = svgRef.current?.querySelector(`[data-sp-ann="${d.id}"]`) as SVGTextElement | null
    if (!d.moved) {
      if (el) openInline(el, d.id)
      return
    }
    const p = toSvgPoint(e.clientX, e.clientY)
    save({ annotations: (edits.annotations ?? []).map((a) => (a.id === d.id ? { ...a, fx: clamp(p.x / size.W), fy: clamp(p.y / size.H) } : a)) })
  }
  const onClick = (e: React.MouseEvent) => {
    if (panel !== "text" || inline) return
    const t = (e.target as Element).closest("text") as SVGTextElement | null
    if (!t || t.closest("[data-sp-ann]")) return
    openInline(t)
  }

  const addText = () => {
    const a: Annotation = { id: Math.random().toString(36).slice(2, 9), text: "New label", fx: 0.5, fy: 0.22, size: 14, color: "#1a1a1a", bold: true }
    save({ annotations: [...(edits.annotations ?? []), a] })
  }
  const updateAnn = (id: string, patch: Partial<Annotation>) => save({ annotations: (edits.annotations ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) })

  // --- colors --------------------------------------------------------------------
  const baseItems = ctx ? colorItems(ctx.base) : []
  const currentItems = currentColors(baseItems, spec)

  const fields: [keyof ChartEdits, string, string][] = [["title", "Title", spec.title]]
  if ("xLabel" in spec) fields.push(["xLabel", "X axis", spec.xLabel])
  if ("yLabel" in spec) fields.push(["yLabel", "Y axis", spec.yLabel])
  if ("valueLabel" in spec) fields.push(["yLabel", "Value axis", spec.valueLabel])

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p))

  return (
    <figure className={`chart ${fullscreen ? "fullscreen" : ""}`}>
      <figcaption>
        <span className="chart-title" onDoubleClick={() => canEdit && setPanel("labels")} title={canEdit ? "Double-click to edit labels" : undefined}>
          {spec.title}
        </span>
        <span className="chart-actions">
          {canEdit && (
            <>
              <button type="button" aria-pressed={panel === "labels"} onClick={() => toggle("labels")}>Labels</button>
              <button type="button" aria-pressed={panel === "colors"} onClick={() => toggle("colors")}>Colors</button>
              <button type="button" aria-pressed={panel === "text"} onClick={() => toggle("text")}>Text</button>
            </>
          )}
          <button type="button" aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}>
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
          <span className="popover-anchor">
            <button type="button" aria-pressed={downloadOpen} onClick={() => setDownloadOpen((v) => !v)}>Download</button>
            {downloadOpen && <DownloadMenu spec={spec} initialPreset={fullscreen ? presetId : "single"} onClose={() => setDownloadOpen(false)} />}
          </span>
        </span>
      </figcaption>

      {fullscreen && (
        <div className="fs-bar">
          <label className="field">
            <span>Preview shape</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {SIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <span className="dim">{preset.use} · Download uses this shape.</span>
        </div>
      )}

      {panel === "labels" && canEdit && (
        <div className="label-editor">
          {fields.map(([key, label, value]) => (
            <LabelField key={label} label={label} value={value} onChange={(v) => save({ [key]: v })} />
          ))}
        </div>
      )}

      {panel === "colors" && canEdit && (
        <ColorsPanel
          spec={spec}
          items={currentItems}
          edits={edits}
          onTheme={(theme) => save({ theme, colors: {} })}
          onColor={(key, color) => save({ colors: { ...(edits.colors ?? {}), [key]: color } })}
          onScale={(colorScale) => save({ colorScale })}
          onReset={() => save({ theme: undefined, colors: {}, colorScale: undefined })}
        />
      )}

      {panel === "text" && canEdit && (
        <div className="text-panel">
          <p className="dim">Click any text on the graph to change it (clear it to hide). Add your own labels and drag them into place.</p>
          <div className="row wrap">
            <button type="button" className="primary" onClick={addText}>+ Add text</button>
            {(Object.keys(edits.renames ?? {}).length > 0 || (edits.annotations ?? []).length > 0) && (
              <button type="button" onClick={() => save({ renames: {}, annotations: [] })}>Reset all text edits</button>
            )}
          </div>
          {(edits.annotations ?? []).map((a) => (
            <div key={a.id} className="ann-row">
              <input value={a.text} onChange={(e) => updateAnn(a.id, { text: e.target.value })} aria-label="Label text" />
              <select value={a.size} onChange={(e) => updateAnn(a.id, { size: Number(e.target.value) })} aria-label="Font size">
                {[9, 10, 11, 12, 14, 16, 18, 22, 28].map((s) => (
                  <option key={s} value={s}>{s} pt</option>
                ))}
              </select>
              <button type="button" aria-pressed={!!a.bold} onClick={() => updateAnn(a.id, { bold: !a.bold })} title="Bold"><b>B</b></button>
              <SwatchButton color={a.color} onPick={(c) => updateAnn(a.id, { color: c })} />
              <button type="button" onClick={() => save({ annotations: (edits.annotations ?? []).filter((x) => x.id !== a.id) })} title="Delete">✕</button>
            </div>
          ))}
          {Object.entries(edits.renames ?? {}).length > 0 && (
            <div className="renames">
              {Object.entries(edits.renames ?? {}).map(([from, to]) => (
                <span key={from} className="tag">
                  “{from}” → {to ? `“${to}”` : <em>hidden</em>}
                  <button type="button" onClick={() => { const r = { ...(edits.renames ?? {}) }; delete r[from]; save({ renames: r }) }} title="Undo">↺</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={stageRef}
        className={`chart-stage ${panel === "text" ? "text-mode" : ""}`}
        style={fullscreen ? ({ aspectRatio: `${size.W} / ${size.H}`, "--ar": size.W / size.H } as React.CSSProperties) : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
      >
        <SizeContext.Provider value={size}>
          <ChartRenderer ref={svgRef} spec={spec} />
        </SizeContext.Provider>
        {inline && (
          <input
            className="inline-text"
            style={{ left: inline.left, top: inline.top, width: inline.width }}
            autoFocus
            defaultValue={inline.value}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitInline(e.currentTarget.value)
              if (e.key === "Escape") setInline(null)
            }}
            onBlur={(e) => commitInline(e.currentTarget.value)}
          />
        )}
      </div>
    </figure>
  )
}

const clamp = (v: number) => Math.max(0.02, Math.min(0.98, v))

/** Current colors (after theme/overrides) for the base items, matched by key. */
function currentColors(base: ColorItem[], applied: ChartSpec): ColorItem[] {
  if (applied.kind === "bars") {
    // The k-th distinct base color maps to the k-th distinct applied color.
    const distinct = [...new Set(applied.colors ?? [])]
    return base.map((it, k) => ({ ...it, color: distinct[k] ?? it.color }))
  }
  const now = colorItems(applied)
  return base.map((it, i) => ({ ...it, color: now.find((n) => n.key === it.key)?.color ?? now[i]?.color ?? it.color }))
}

function ColorsPanel({ spec, items, edits, onTheme, onColor, onScale, onReset }: { spec: ChartSpec; items: ColorItem[]; edits: ChartEdits; onTheme: (t: string) => void; onColor: (key: string, c: string) => void; onScale: (s: string) => void; onReset: () => void }) {
  return (
    <div className="colors-panel">
      {items.length > 0 && (
        <>
          <div className="panel-label">Palette</div>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.name} type="button" className={`theme-chip ${edits.theme === t.name ? "active" : ""}`} onClick={() => onTheme(t.name)} title={t.note}>
                <span className="theme-swatches">
                  {t.colors.slice(0, 8).map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </span>
                <span className="theme-name">{t.name}</span>
                {t.note && <span className="theme-note">{t.note}</span>}
              </button>
            ))}
          </div>
          <div className="panel-label">Each {spec.kind === "xy" ? "series" : spec.kind === "bars" ? "bar color" : "group"}</div>
          <div className="item-colors">
            {items.map((it) => (
              <div key={it.key} className="item-color">
                <SwatchButton color={it.color} onPick={(c) => onColor(it.key, c)} />
                <span title={it.label}>{it.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {spec.kind === "heatmap" && (
        <>
          <div className="panel-label">Heatmap color scale</div>
          <div className="theme-grid">
            {COLOR_SCALES.filter((s) => s.kind === spec.scale).map((s) => (
              <button key={s.name} type="button" className={`theme-chip ${spec.colorScale === s.name || (!spec.colorScale && s === COLOR_SCALES.find((x) => x.kind === spec.scale)) ? "active" : ""}`} onClick={() => onScale(s.name)}>
                <span className="scale-bar" style={{ background: `linear-gradient(90deg, ${s.stops.join(",")})` }} />
                <span className="theme-name">{s.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row">
        <button type="button" onClick={onReset}>Reset colors</button>
      </div>
    </div>
  )
}

/** A color square that opens the extended swatch grid plus a custom color picker. */
function SwatchButton({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [open])
  const hex = toHex(color)
  return (
    <span className="popover-anchor" ref={ref}>
      <button type="button" className="swatch-btn" style={{ background: color }} onClick={() => setOpen((v) => !v)} aria-label={`Color ${hex}`} />
      {open && (
        <div className="swatch-pop">
          <div className="swatch-grid">
            {SWATCHES.map((c) => (
              <button key={c} type="button" style={{ background: c }} className={c.toLowerCase() === hex.toLowerCase() ? "on" : ""} onClick={() => { onPick(c); setOpen(false) }} aria-label={c} />
            ))}
          </div>
          <div className="row custom-color">
            <label>
              Custom <input type="color" value={hex} onChange={(e) => onPick(e.target.value)} />
            </label>
            <input
              className="hex"
              defaultValue={hex}
              onKeyDown={(e) => {
                const v = e.currentTarget.value.trim()
                if (e.key === "Enter" && /^#?[0-9a-f]{6}$/i.test(v)) {
                  onPick(v.startsWith("#") ? v : `#${v}`)
                  setOpen(false)
                }
              }}
              aria-label="Hex color"
            />
          </div>
        </div>
      )}
    </span>
  )
}

function toHex(c: string) {
  if (c.startsWith("#")) return c.length === 4 ? "#" + [...c.slice(1)].map((x) => x + x).join("") : c.slice(0, 7)
  const m = c.match(/\d+/g)
  return m ? "#" + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("") : "#000000"
}

export function DownloadMenu({ spec, initialPreset, onClose }: { spec: ChartSpec; initialPreset: string; onClose: () => void }) {
  const [presetId, setPresetId] = useState(initialPreset)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".popover-anchor") && onClose()
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [onClose])
  const preset = presetById(presetId)
  const run = async (f: ExportFormat) => {
    setBusy(f)
    setErr(null)
    try {
      await exportChart(spec, preset, f)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="download-pop" ref={ref}>
      <div className="panel-label">Size &amp; shape</div>
      <div className="preset-list">
        {SIZE_PRESETS.map((p) => (
          <label key={p.id} className={`preset ${p.id === presetId ? "on" : ""}`}>
            <input type="radio" name={`preset-${spec.title}`} checked={p.id === presetId} onChange={() => setPresetId(p.id)} />
            <span className="ratio" style={{ aspectRatio: `${p.W} / ${p.H}` }} />
            <span>
              <strong>{p.label}</strong>
              <small>{p.use}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="panel-label">Format</div>
      <div className="format-list">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" onClick={() => void run(f.id)} disabled={!!busy} title={f.use}>
            <strong>{busy === f.id ? "Saving…" : f.label}</strong>
            <small>{f.use}</small>
          </button>
        ))}
      </div>
      {err && <div className="problem">{err}</div>}
    </div>
  )
}
