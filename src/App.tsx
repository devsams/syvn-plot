import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { injectBasicCatalogStyles } from "@a2ui/web_core/v0_9/basic_catalog"

import { ApiKeyModal } from "./ApiKeyModal"
import { SearchBar } from "./SearchBar"
import { Icon } from "./Icon"
import { START_TOUR_EVENT, cleanupDriverDom, replayTour, runTour, shouldAutoStart } from "./tour"
import type { Driver } from "driver.js"
import type { SearchEntry } from "./lib/searchIndex"
import { ChatPanel, type Computed } from "./ChatPanel"
import { ColumnCards, DataPreview } from "./DataSummary"
import { DataSentence, HomeSentence } from "./Hero"
import type { ComponentOverride } from "./lib/a2uiValidate"
import { aiStatus } from "./lib/ai"
import { ANALYSES, analysisById, type AnalysisId } from "./lib/analysis-defs"
import { defaultParams, detectAll, levelsOf, type Roles } from "./lib/analyses"
import { clearByok, loadByok, providerName, saveByok, type ByokSettings } from "./lib/byok"
import { chartTypesFor, normalizeSpec, renameInSpec, specFromDetection, type ChartType, type GraphSpec } from "./lib/graphSpec"
import type { ColumnStyle } from "./lib/specs"
import { parseCsvText, readFile, type Dataset } from "./lib/parse"
import { SAMPLE_EXPERIMENTS, type SampleExperiment } from "./lib/samples"
import { ResearchSurface } from "./research/ResearchSurface"
import { AiActionsContext, type AiTask } from "./research/context"
import { validateGraphSpec } from "./lib/graphSpec"

injectBasicCatalogStyles()

const GROUPS = [...new Set(ANALYSES.map((a) => a.group))]

/** Largest data file accepted (2 MB) — keeps parsing fast in the browser and the hosted app light. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
type Msg = Record<string, unknown>

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [spec, setSpec] = useState<GraphSpec | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [sample, setSample] = useState<SampleExperiment | null>(null)
  const [overrides, setOverrides] = useState<ComponentOverride[]>([])
  const [agentLog, setAgentLog] = useState<Msg[]>([])
  const [components, setComponents] = useState<{ id: string; component: string }[]>([])
  const [byok, setByok] = useState<ByokSettings>(loadByok)
  const [keyOpen, setKeyOpen] = useState(false)
  const [status, setStatus] = useState<Awaited<ReturnType<typeof aiStatus>>>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const [computed, setComputed] = useState<Computed>(null)
  const [requested, setRequested] = useState<AiTask | null>(null)
  const [cleanupUndo, setCleanupUndo] = useState<{ dataset: Dataset; spec: GraphSpec | null }[]>([])

  const refreshStatus = useCallback(() => void aiStatus().then(setStatus), [])
  useEffect(refreshStatus, [refreshStatus])

  const detections = useMemo(() => (dataset ? detectAll(dataset) : []), [dataset])

  const newDataset = (ds: Dataset, nextSpec: GraphSpec | null) => {
    setCleanupUndo([])
    setDataset(ds)
    setSpec(nextSpec)
    setOverrides([])
    setAgentLog([])
  }

  const load = useCallback(async (f: File, sheet?: string) => {
    try {
      setProblem(null)
      if (f.size > MAX_FILE_BYTES)
        throw new Error(`“${f.name}” is ${fmtSize(f.size)} — the limit is 2 MB. Try saving just the sheet or columns you need (or as CSV, which is usually smaller), then upload again.`)
      const parsed = await readFile(f, sheet)
      if (parsed.columns.length === 0) throw new Error("That file has no readable columns. Check that it's a CSV or Excel sheet with a header row.")
      if (parsed.rowCount === 0) throw new Error("That file has column names but no data rows.")
      setFile(f)
      setSample(null)
      newDataset(parsed, null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }, [])

  /** Samples open straight into the analysis and settings they're meant to show. */
  const loadSample = async (exp: SampleExperiment, extra: { params?: Record<string, string>; chartType?: ChartType } = {}) => {
    const text = await fetch(`${import.meta.env.BASE_URL}samples/${exp.file}`).then((r) => r.text())
    const ds = parseCsvText(exp.file, text)
    setFile(null)
    setProblem(null)
    let next = specFromDetection(ds, exp.analysis, { roles: exp.roles, params: { ...(exp.params ?? {}), ...(extra.params ?? {}) }, style: (extra.chartType as ColumnStyle | undefined) ?? exp.style, error: exp.error })
    if (extra.chartType && chartTypesFor(next.analysis).includes(extra.chartType)) next = normalizeSpec({ ...next, chartType: extra.chartType }, next, ds)
    newDataset(ds, next)
    setSample(exp)
  }

  const update = useCallback((next: GraphSpec) => setSpec(next), [])
  const onSurfaceSpec = useCallback((next: GraphSpec) => setSpec(next), [])

  const pickAnalysis = (id: AnalysisId) => dataset && spec && setSpec(normalizeSpec({ ...spec, analysis: id }, spec, dataset))
  const setRole = (key: string, cols: string[]) => {
    if (!dataset || !spec) return
    const roles: Roles = { ...spec.roles, [key]: cols }
    const def = analysisById(spec.analysis)
    const keep = Object.fromEntries(Object.entries(spec.params).filter(([k]) => { const d = def?.params?.find((p) => p.key === k); return !d?.levelsOf && !d?.columnsOf }))
    update(normalizeSpec({ ...spec, roles, params: { ...defaultParams(dataset, spec.analysis as AnalysisId, roles), ...keep } }, spec, dataset))
  }
  const setParam = (k: string, v: string) => spec && dataset && update(normalizeSpec({ ...spec, params: { ...spec.params, [k]: v } }, spec, dataset))

  const renameColumn = (from: string, to: string) => {
    if (!dataset) return
    const name = to.trim()
    if (!name || name === from) return
    if (dataset.columns.some((c) => c.name === name)) return setProblem(`There's already a column called “${name}”.`)
    setProblem(null)
    setDataset({ ...dataset, columns: dataset.columns.map((c) => (c.name === from ? { ...c, name } : c)) })
    if (spec) setSpec(renameInSpec(spec, from, name))
  }

  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener("dragover", stop)
    window.addEventListener("drop", stop)
    return () => {
      window.removeEventListener("dragover", stop)
      window.removeEventListener("drop", stop)
    }
  }, [])

  /** Approved AI cleanup: swap in the cleaned data; keep the graph if it still fits, otherwise re-suggest. */
  const applyCleanedData = (cleaned: Dataset) => {
    if (!dataset) return
    setCleanupUndo((prev) => [...prev, { dataset, spec }])
    setDataset(cleaned)
    if (spec) setSpec(validateGraphSpec(spec, cleaned).length ? specFromDetection(cleaned, detectAll(cleaned)[0].id) : spec)
  }
  const undoCleanup = () => {
    const last = cleanupUndo[cleanupUndo.length - 1]
    if (!last) return
    setCleanupUndo((prev) => prev.slice(0, -1))
    setDataset(last.dataset)
    setSpec(last.spec)
  }

  /** Search: apply an analysis / test / graph type to the loaded data, load a sample, or open a feature. */
  const flash = (text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000)
  }
  const scrollToGraph = () => setTimeout(() => document.querySelector(".workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120)
  const clickIn = (selector: string, text: string) => setTimeout(() => ([...document.querySelectorAll(selector)].find((b) => b.textContent?.includes(text)) as HTMLElement | undefined)?.click(), 350)

  const onSearchPick = async (e: SearchEntry) => {
    const a = e.action
    if (a.kind === "sample") {
      await loadSample(SAMPLE_EXPERIMENTS[a.index])
      flash(`Opened the sample “${SAMPLE_EXPERIMENTS[a.index].title}”.`)
      return scrollToGraph()
    }
    if (a.kind === "feature") {
      if (a.feature === "apikey") return setKeyOpen(true)
      if (a.feature === "upload") return inputRef.current?.click()
      if (!dataset || !spec) return flash("Load a file or pick a sample experiment first, then try this again.")
      scrollToGraph()
      if (a.feature === "logy") {
        setSpec({ ...spec, yScale: "log" })
        return flash("✓ Y axis switched to log scale.")
      }
      if (a.feature === "export") return clickIn(".export-ctl button", "Export")
      if (a.feature === "colors") return clickIn(".surface .chart-actions button", "Colors")
      if (a.feature === "text") return clickIn(".surface .chart-actions button", "Text")
      if (a.feature === "fullscreen") return clickIn(".surface .chart-actions button", "Full screen")
      if (a.feature === "filter") return clickIn(".filter-ctl button", "+ Filter")
      if (a.feature === "legend") return setTimeout(() => document.querySelector(".figure-text")?.scrollIntoView({ behavior: "smooth", block: "center" }), 150)
      if (a.feature === "rename") {
        const d = document.querySelector("details.preview") as HTMLDetailsElement | null
        if (d) d.open = true
        return clickIn(".preview-head button", "Rename")
      }
      if (a.feature === "cleanup") return aiAvailable ? setRequested("cleanup") : (flash("Data cleanup uses AI — add your API key first."), setKeyOpen(true))
      return
    }
    const analyses = a.kind === "analysis" ? [a.analysis] : a.analyses
    const params = a.params ?? {}
    const chartType = a.kind === "analysis" ? a.chartType : undefined
    if (!dataset) {
      const exp = SAMPLE_EXPERIMENTS.find((x) => analyses.includes(x.analysis))
      if (!exp) return flash("Upload a file first.")
      await loadSample(exp, { params, chartType })
      flash(`Showing “${e.title}” on the sample “${exp.title}”. Drop your own file to use your data.`)
      return scrollToGraph()
    }
    const current = spec?.analysis as AnalysisId | undefined
    const id = current && analyses.includes(current) ? current : [...analyses].sort((x, y) => scoreOf(y) - scoreOf(x))[0]
    let next = spec ? (spec.analysis === id ? spec : normalizeSpec({ ...spec, analysis: id }, spec, dataset)) : specFromDetection(dataset, id)
    next = { ...next, params: { ...next.params, ...params } }
    if (chartType && chartTypesFor(id).includes(chartType)) next = normalizeSpec({ ...next, chartType }, next, dataset)
    setSpec(next)
    const fits = scoreOf(id) >= 30
    flash(`✓ ${e.title}${fits ? "" : " — this analysis may not match how your data is laid out; check “Columns & options”."}`)
    scrollToGraph()
  }

  const def = spec ? analysisById(spec.analysis) : undefined
  const scoreOf = (id: string) => detections.find((d) => d.id === id)?.score ?? 0
  const freeKey = status?.serverKeys?.[byok.provider]
  const quotaNote = freeKey ? `Free tier · ${status!.quota.used}/${status!.quota.limit} today · add your key for unlimited` : "No AI key yet — add yours"
  const aiAvailable = !!byok.key || !!freeKey
  const aiActions = useMemo(() => ({ available: aiAvailable, run: (t: AiTask) => setRequested(t) }), [aiAvailable])
  const title = sample && dataset && sample.file === dataset.fileName ? `${sample.title} (${dataset.fileName})` : dataset ? (dataset.sheetName ? `${dataset.fileName} — ${dataset.sheetName}` : dataset.fileName) : ""

  const loadSampleRef = useRef(loadSample)
  loadSampleRef.current = loadSample
  useEffect(() => {
    let tour: Driver | null = null
    const start = () => {
      if (tour?.isActive()) tour.destroy()
      cleanupDriverDom()
      tour = runTour({
        ensureGraph: () => {
          const exp = SAMPLE_EXPERIMENTS.find((e) => e.file === "drug-response.csv") ?? SAMPLE_EXPERIMENTS[0]
          return loadSampleRef.current(exp)
        },
      })
    }
    window.addEventListener(START_TOUR_EVENT, start)
    let raf = 0
    if (shouldAutoStart()) raf = requestAnimationFrame(() => requestAnimationFrame(start))
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener(START_TOUR_EVENT, start)
      if (tour?.isActive()) tour.destroy()
      cleanupDriverDom()
    }
  }, [])

  const openSearch = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
  const goHome = () => {
    setDataset(null)
    setSpec(null)
    setSample(null)
    setFile(null)
    setProblem(null)
    requestAnimationFrame(() => document.querySelector(".home-scroll")?.scrollTo({ top: 0 }))
  }
  const openSamples = (group?: string) => {
    if (dataset) goHome()
    setTimeout(() => document.getElementById(group ? `group-${group}` : "samples")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60)
  }
  const buildFromColumns = (id: AnalysisId, roles: Roles) => {
    if (!dataset) return
    const s = specFromDetection(dataset, id, { roles, params: defaultParams(dataset, id, roles) })
    setSpec(normalizeSpec(s, s, dataset))
  }

  const mode = !dataset ? "home" : !spec || !def ? "data" : "graph"
  const sheetPicker =
    dataset?.sheetNames && dataset.sheetNames.length > 1 && file ? (
      <label className="field">
        <span>Sheet</span>
        <select value={dataset.sheetName} onChange={(e) => void load(file, e.target.value)}>
          {dataset.sheetNames.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
    ) : null
  const headline = computed?.result.headline

  return (
    <div
      className={`shell mode-${mode}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void load(f)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void load(f)
          e.target.value = ""
        }}
      />
      <nav className="rail" data-tour="nav" aria-label="Main">
        <button type="button" className="brand-mark" onClick={goHome} title="Syvn Plot — home" aria-label="Syvn Plot home">SP</button>
        <button type="button" className={`rail-btn ${mode === "home" ? "on" : ""}`} onClick={goHome} title="New graph" aria-label="New graph">
          <Icon name="plus" size={18} />
        </button>
        <button type="button" className="rail-btn" onClick={() => inputRef.current?.click()} title="Upload data" aria-label="Upload data">
          <Icon name="upload" size={18} />
        </button>
        <button type="button" className="rail-btn" onClick={() => openSamples()} title="Sample experiments" aria-label="Sample experiments">
          <Icon name="flask" size={18} />
        </button>
        <button type="button" className="rail-btn" onClick={openSearch} title="Search (⌘K)" aria-label="Search">
          <Icon name="search" size={18} />
        </button>
        <span className="rail-gap" />
        <button type="button" className="rail-btn" data-tour="replay" onClick={replayTour} title="Take the tour" aria-label="Take the tour">
          <Icon name="compass" size={18} />
        </button>
        <button type="button" className={`rail-btn key-btn-rail ${byok.key ? "has-key" : ""}`} onClick={() => setKeyOpen(true)} title={byok.key ? `${providerName(byok.provider)} key saved` : "Add AI key"} aria-label="AI key settings">
          <Icon name="key" size={18} />
          <span className={`dot ${byok.key ? "on" : ""}`} />
        </button>
      </nav>

      <div className="stage">
        <header className="topbar">
          <div className="crumbs">
            <button type="button" className="crumb-home" onClick={goHome}>Syvn Plot</button>
            {dataset && (
              <>
                <span className="crumb-sep">/</span>
                <span className="crumb-file" title={title}>{dataset.fileName}</span>
              </>
            )}
            {mode === "graph" && def && (
              <>
                <span className="crumb-sep">/</span>
                <span className="crumb-now">{def.label}</span>
              </>
            )}
          </div>
          <SearchBar onPick={(e) => void onSearchPick(e)} />
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button type="button" className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {mode !== "graph" && (
          <div className="home-scroll">
            <section className="hero" data-tour="upload">
              <div className="hero-glow" aria-hidden />
              {mode === "data" && dataset && (
                <div className="hero-file">
                  <span className="hero-eyebrow"><Icon name="file" size={14} /> {dataset.fileName}{dataset.sheetName ? ` — ${dataset.sheetName}` : ""} · {dataset.rowCount} rows · {dataset.columns.length} columns</span>
                  {sheetPicker}
                </div>
              )}
              {mode === "home" ? (
                <HomeSentence onBuild={(exp) => void loadSample(exp)} onUpload={() => inputRef.current?.click()} />
              ) : (
                dataset && <DataSentence key={`${dataset.fileName}|${dataset.sheetName ?? ""}|${dataset.columns.map((c) => c.name).join()}`} dataset={dataset} detections={detections} onBuild={buildFromColumns} />
              )}
              <p className="hero-sub">
                {mode === "home" ? "or drop a CSV or Excel file anywhere" : "Change any chip, or drop a different file"} ·{" "}
                <button type="button" className="link-btn" onClick={() => inputRef.current?.click()}>choose a file</button> · up to 2 MB
              </p>
              {problem && <div className="problem hero-problem">{problem}</div>}
              <div className="foot-pill">
                <span className="brand-mark small">SP</span>
                <span>Statistics run in your browser — your file is never uploaded.<br />AI is optional and only runs when you click.</span>
              </div>
            </section>

            {mode === "data" && dataset && (
              <section className="home-section">
                <h2 className="home-h">What's in the file</h2>
                <ColumnCards dataset={dataset} />
              </section>
            )}

            {mode === "home" && (
              <section id="samples" data-tour="samples" className="home-section">
                <h2 className="home-h">Sample experiments <span className="dim">· {SAMPLE_EXPERIMENTS.length}, one for every analysis</span></h2>
                {GROUPS.map((g) => (
                  <div key={g} id={`group-${g}`} className="sample-group">
                    <h3>{g}</h3>
                    <div className="sample-grid">
                      {SAMPLE_EXPERIMENTS.filter((e) => analysisById(e.analysis)?.group === g).map((e) => (
                        <button key={e.title} type="button" className="sample-card" onClick={() => void loadSample(e)}>
                          <span className="exp">{e.experiment}</span>
                          <strong>{e.title}</strong>
                          <span className="as">{analysisById(e.analysis)?.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {mode === "graph" && dataset && spec && def && (
          <div className="board">
            <div className="canvas">
              <div className="canvas-inner">
                <header className="dash-head">
                  <span className="hero-eyebrow">{sample && sample.file === dataset.fileName ? `Sample experiment · ${sample.experiment}` : `Your data${dataset.sheetName ? ` · ${dataset.sheetName}` : ""}`}</span>
                  <h1>{sample && sample.file === dataset.fileName ? sample.title : dataset.fileName}</h1>
                  <p>{sample && sample.file === dataset.fileName ? sample.description : def.description}</p>
                </header>

                <div className="kpis">
                  <div className="kpi">
                    <span className="kpi-icon tone-sky"><Icon name="rows" size={16} /></span>
                    <strong>{dataset.rowCount.toLocaleString()}</strong>
                    <span>rows · {dataset.columns.length} columns</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-icon tone-violet"><Icon name="chart" size={16} /></span>
                    <strong className="kpi-text">{def.label}</strong>
                    <span>{def.group}</span>
                  </div>
                  <div className="kpi kpi-wide">
                    <span className="kpi-icon tone-green"><Icon name="sparkles" size={16} /></span>
                    <strong className="kpi-text" title={headline}>{headline || "Calculating…"}</strong>
                    <span>At a glance</span>
                  </div>
                </div>

                <section className="toolbar-card" data-tour="analysis">
                  {sheetPicker}
                  <label className="field grow">
                    <span>Analysis</span>
                    <select value={spec.analysis} onChange={(e) => pickAnalysis(e.target.value as AnalysisId)}>
                      {GROUPS.map((g) => (
                        <optgroup key={g} label={g}>
                          {ANALYSES.filter((a) => a.group === g).map((a) => (
                            <option key={a.id} value={a.id}>
                              {scoreOf(a.id) >= 30 ? "● " : "  "}
                              {a.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <span className="dim small toolbar-note">● = fits this data</span>
                </section>

                <details className="panel setup">
                  <summary>
                    <strong>Columns &amp; options</strong>
                    {spec.xColumn ? ` · X: ${spec.xColumn}` : ""}
                    {spec.yColumns.length ? ` · Y: ${spec.yColumns.slice(0, 3).join(", ")}${spec.yColumns.length > 3 ? "…" : ""}` : ""}
                    {spec.groupBy ? ` · Group: ${spec.groupBy}` : ""}
                  </summary>
                  <div className="row">
                    <button type="button" className="ghost" onClick={() => setShowMessages((v) => !v)}>
                      {showMessages ? "Hide" : "Show"} A2UI messages
                    </button>
                  </div>
                  <div className="row wrap">
                    {def.roles.map((r) => {
                      const eligible = dataset.columns.filter((c) => r.kinds.includes(c.kind) || (r.kinds.includes("category") && c.kind === "text"))
                      const chosen = spec.roles[r.key] ?? []
                      return r.multiple ? (
                        <div key={r.key} className="field">
                          <span>
                            {r.label}
                            {r.optional ? " (optional)" : ""}
                          </span>
                          <div className="chips">
                            {eligible.map((c) => (
                              <button key={c.name} type="button" aria-pressed={chosen.includes(c.name)} onClick={() => setRole(r.key, chosen.includes(c.name) ? chosen.filter((n) => n !== c.name) : [...chosen, c.name])}>
                                {c.name}
                              </button>
                            ))}
                            {!eligible.length && <em className="dim">no {r.kinds.join("/")} columns</em>}
                          </div>
                        </div>
                      ) : (
                        <label key={r.key} className="field">
                          <span>{r.label}</span>
                          <select value={chosen[0] ?? ""} onChange={(e) => setRole(r.key, e.target.value ? [e.target.value] : [])}>
                            {(r.optional || !chosen.length) && <option value="">{r.optional ? "(none)" : "— pick —"}</option>}
                            {eligible.map((c) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                    {(def.params ?? [])
                      .filter((p) => !(spec.analysis === "two_way" && p.key === "chart") && p.key !== "test" && p.key !== "posthoc")
                      .map((p) => {
                        const src = p.levelsOf ? dataset.columns.find((c) => c.name === spec.roles[p.levelsOf!]?.[0]) : undefined
                        const choices = p.values ?? (p.columnsOf ? (spec.roles[p.columnsOf] ?? []) : src ? levelsOf(src) : [])
                        return (
                          <label key={p.key} className="field">
                            <span>{p.label}</span>
                            <select value={spec.params[p.key] ?? ""} onChange={(e) => setParam(p.key, e.target.value)}>
                              {choices.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                        )
                      })}
                  </div>
                </details>

                {problem && <div className="problem">{problem}</div>}
                <DataPreview dataset={dataset} onRename={renameColumn} />

                <div className="workspace">
                  <main className="surface">
                    <AiActionsContext.Provider value={aiActions}>
                      <ResearchSurface
                        key={`${dataset.fileName}|${dataset.sheetName ?? ""}`}
                        ds={dataset}
                        spec={spec}
                        onSpec={onSurfaceSpec}
                        title={title}
                        overrides={overrides}
                        showMessages={showMessages}
                        agentLog={agentLog}
                        onComponents={setComponents}
                        onComputed={setComputed}
                      />
                    </AiActionsContext.Provider>
                  </main>
                </div>
              </div>
            </div>
            <aside className="side" data-tour="assistant">
              <ChatPanel
                dataset={dataset}
                spec={spec}
                components={components}
                computed={computed}
                byok={byok}
                available={aiAvailable}
                quotaNote={quotaNote}
                requested={requested}
                onRequestHandled={() => setRequested(null)}
                onCleanupApply={(ds) => {
                  applyCleanedData(ds)
                  refreshStatus()
                }}
                onCleanupUndo={undoCleanup}
                onApply={(next, messages, ov) => {
                  setSpec(next)
                  if (ov.length) setOverrides((prev) => [...prev.filter((p) => !ov.some((o) => o.id === p.id)), ...ov])
                  setAgentLog((prev) => [...prev, ...messages].slice(-30))
                  refreshStatus()
                }}
                onUndo={(prev) => setSpec(prev)}
                onOpenKey={() => setKeyOpen(true)}
              />
            </aside>
          </div>
        )}
      </div>

      {dragging && (
        <div className="drop-veil" aria-hidden>
          <div>
            <Icon name="upload" size={28} />
            <strong>Drop to open</strong>
            <span>CSV or Excel · up to 2 MB</span>
          </div>
        </div>
      )}

      {keyOpen && (
        <ApiKeyModal
          settings={byok}
          status={status}
          onClose={() => setKeyOpen(false)}
          onSave={(s) => {
            saveByok(s)
            setByok(s)
            setKeyOpen(false)
          }}
          onClear={() => {
            clearByok()
            setByok({ ...byok, key: "" })
            setKeyOpen(false)
          }}
        />
      )}
    </div>
  )
}
