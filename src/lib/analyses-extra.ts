/**
 * Curve metrics (PK, growth, melt, Cq, chromatogram peaks), heatmaps and
 * multivariate plots (matrix heatmap, Bliss synergy, PCA, colored scatter,
 * MA), assay helpers (qPCR standard curve, Z′) and specialized plots
 * (waterfall, forest, ranked bars).
 */
import { numbersOf, toNumber, type Column, type Dataset } from "./parse"
import type { BarsSpec, ChartSpec, TableSpec, XYSeries } from "./specs"
import { clusterOrder, fit4PL, fmt, fourPL, linearFit, mean, pca, summarize, trapezoid, zscoreRow } from "./stats"
import { PALETTE_FOR, RE, byName, cols, levelsOf, names, need, replicateSets, role, roleAll, str, errHalf, errLabel, type Params, type Result, type Roles, type RunOptions } from "./helpers"
import { arrMin, arrMax } from "./minmax"

type Detector = (ds: Dataset) => { score: number; roles: Roles; params?: Params } | null
type Runner = (ds: Dataset, roles: Roles, params: Params, opts: RunOptions) => Result

export type ExtraId = "pk" | "growth" | "melt" | "amplification" | "chromatogram" | "matrix_heatmap" | "synergy" | "pca" | "scatter_groups" | "ma_plot" | "qpcr_standard" | "zprime" | "waterfall" | "forest" | "ranked_bars"

const X = {
  conc: /conc|plasma|serum|ng\/ml|µg\/ml|ug\/ml|nmol|µmol|mg\/l|ng\/g/i,
  od: /od ?600|od600|\bod\b|optical density|confluen|cell count|cfu|cells\/ml|biomass/i,
  temp: /temp|°c|\bdeg|degree|celsius/i,
  cycle: /cycle/i,
  retention: /retention|elution|volume|\bml\b|time|min/i,
  chromSignal: /mau|\buv\b|a280|a260|a214|absorbance|fluor|signal|detector|intensity/i,
  rowLabel: /gene|protein|cytokine|chemokine|analyte|marker|pathway|feature|symbol|probe|metabolite|term|transcript|peptide|region|peak|time ?point/i,
  coords: /umap|tsne|t-sne|^pc ?\d|dim ?\d|fsc|ssc|^x$|^y$|component ?\d/i,
  a: /basemean|base mean|aveexpr|ave expr|logcpm|log cpm|mean expr|^a$|average expression|amean/i,
  quantity: /quantity|copies|copy|dilution|template|\bng\b|starting|input|std ?conc/i,
  pos: /^(pos|positive|max|high|\+|pc|stim|stimulated|full|100%)( ?(ctrl|control|ctl))?$/i,
  neg: /^(neg|negative|min|low|-|nc|blank|vehicle|dmso|unstim|unstimulated|background|0%|buffer)( ?(ctrl|control|ctl))?$/i,
  change: /% ?change|percent change|change from baseline|best response|% from baseline|tumou?r change/i,
  lower: /lower|lcl|ci.?low|ci_l|2\.5|ll\b|min ci/i,
  upper: /upper|ucl|ci.?high|ci_u|97\.5|ul\b|max ci/i,
  estimate: /\bor\b|\bhr\b|\brr\b|estimate|ratio|effect|beta|mean diff|odds|hazard|smd|coef/i,
  term: /term|pathway|go\b|description|process|kegg|reactome|category|gene set|geneset/i,
}

const nums = (ds: Dataset) => cols(ds, ["number"])
const labelish = (ds: Dataset) => ds.columns.filter((c) => (c.kind === "text" || c.kind === "category") && levelsOf(c).length === c.values.filter((v) => v !== null).length)
const sortedPts = (xs: (number | null)[], ys: (number | null)[]) =>
  xs.flatMap((x, i) => (x !== null && ys[i] !== null && Number.isFinite(x) && Number.isFinite(ys[i]!) ? [{ x, y: ys[i]! }] : [])).sort((a, b) => a.x - b.x)
const asNums = (c: Column) => c.values.map(toNumber)

export const EXTRA_DETECT: Record<ExtraId, Detector> = {
  pk: (ds) => {
    const t = nums(ds).find((c) => RE.time.test(c.name))
    const conc = nums(ds).filter((c) => c !== t && X.conc.test(c.name))
    return t && conc.length ? { score: 86, roles: { time: [t.name], conc: names(conc) } } : null
  },
  growth: (ds) => {
    const t = nums(ds).find((c) => RE.time.test(c.name))
    const od = nums(ds).filter((c) => c !== t && X.od.test(c.name))
    return t && od.length ? { score: 84, roles: { time: [t.name], od: names(od) } } : null
  },
  melt: (ds) => {
    const t = nums(ds).find((c) => X.temp.test(c.name))
    const sig = nums(ds).filter((c) => c !== t)
    return t && sig.length ? { score: 86, roles: { temp: [t.name], signal: names(sig) } } : null
  },
  amplification: (ds) => {
    const c = nums(ds).find((x) => X.cycle.test(x.name))
    const rfu = nums(ds).filter((x) => x !== c)
    return c && rfu.length && ds.rowCount >= 20 ? { score: 90, roles: { cycle: [c.name], rfu: names(rfu) } } : null
  },
  chromatogram: (ds) => {
    const t = nums(ds).find((c) => X.retention.test(c.name))
    const s = nums(ds).find((c) => c !== t && X.chromSignal.test(c.name))
    return t && s && ds.rowCount >= 100 && nums(ds).length <= 3 ? { score: 85, roles: { time: [t.name], signal: [s.name] } } : null
  },
  matrix_heatmap: (ds) => {
    const label = labelish(ds)[0] ?? ds.columns.find((c) => c.kind !== "number")
    const vals = nums(ds)
    if (!label || vals.length < 3 || ds.rowCount < 4) return null
    return { score: X.rowLabel.test(label.name) ? 80 : 35, roles: { label: [label.name], values: names(vals) } }
  },
  synergy: (ds) => {
    const doses = nums(ds).filter((c) => RE.dose.test(c.name) || /drug ?[ab12]|dose ?[ab12]/i.test(c.name))
    if (doses.length < 2 || !doses.slice(0, 2).every((c) => numbersOf(c).some((v) => v === 0))) return null
    const resp = nums(ds).find((c) => !doses.slice(0, 2).includes(c))
    return resp ? { score: 91, roles: { doseA: [doses[0].name], doseB: [doses[1].name], response: [resp.name] }, params: { responseIs: /inhib/i.test(resp.name) ? "% inhibition" : "% viability" } } : null
  },
  pca: (ds) => {
    const vals = nums(ds)
    if (vals.length < 3) return null
    const g = cols(ds, ["category"])[0]
    const label = labelish(ds)[0]
    return { score: vals.length >= 8 && g && ds.rowCount >= 6 ? 65 : 12, roles: { values: names(vals), group: g ? [g.name] : [], label: label ? [label.name] : [] } }
  },
  scatter_groups: (ds) => {
    const c = nums(ds).filter((x) => X.coords.test(x.name))
    if (c.length < 2) return null
    const g = ds.columns.find((x) => x.kind === "category" || (x.kind === "text" && levelsOf(x).length <= 30))
    return { score: 88, roles: { x: [c[0].name], y: [c[1].name], group: g ? [g.name] : [] } }
  },
  ma_plot: (ds) => {
    const a = nums(ds).find((c) => X.a.test(c.name))
    const fc = nums(ds).find((c) => RE.fc.test(c.name))
    if (!a || !fc) return null
    const p = [...nums(ds)].reverse().find((c) => c !== fc && c !== a && RE.p.test(c.name))
    return { score: p ? 70 : 90, roles: { a: [a.name], fc: [fc.name], p: p ? [p.name] : [] } }
  },
  qpcr_standard: (ds) => {
    const ct = nums(ds).filter((c) => RE.ct.test(c.name))
    const q = nums(ds).find((c) => X.quantity.test(c.name) && !ct.includes(c))
    if (!ct.length || !q) return null
    const primer = ds.columns.find((c) => c.kind === "category" && /primer|gene|target|assay/i.test(c.name))
    return { score: 97, roles: { quantity: [q.name], ct: names(ct), primer: primer ? [primer.name] : [] } }
  },
  zprime: (ds) => {
    const type = ds.columns.find((c) => c.kind !== "number" && levelsOf(c).length <= 12 && levelsOf(c).some((l) => X.pos.test(l)) && levelsOf(c).some((l) => X.neg.test(l)))
    const sig = nums(ds)[0]
    if (!type || !sig) return null
    const batch = ds.columns.find((c) => c !== type && /plate|batch|run|day/i.test(c.name))
    const lv = levelsOf(type)
    return { score: 86, roles: { type: [type.name], signal: [sig.name], batch: batch ? [batch.name] : [] }, params: { positive: lv.find((l) => X.pos.test(l))!, negative: lv.find((l) => X.neg.test(l))! } }
  },
  waterfall: (ds) => {
    const ch = nums(ds).find((c) => X.change.test(c.name))
    if (!ch) return null
    const label = labelish(ds)[0]
    const g = cols(ds, ["category"])[0]
    return { score: 88, roles: { change: [ch.name], baseline: [], followup: [], group: g ? [g.name] : [], label: label ? [label.name] : [] } }
  },
  forest: (ds) => {
    const lo = nums(ds).find((c) => X.lower.test(c.name))
    const hi = nums(ds).find((c) => c !== lo && X.upper.test(c.name))
    const est = nums(ds).find((c) => c !== lo && c !== hi && X.estimate.test(c.name)) ?? nums(ds).find((c) => c !== lo && c !== hi)
    const label = ds.columns.find((c) => c.kind === "text" || c.kind === "category")
    if (!lo || !hi || !est || !label) return null
    const ratio = /\bor\b|\bhr\b|\brr\b|ratio|odds|hazard/i.test(est.name) || numbersOf(lo).every((v) => v > 0)
    return { score: 95, roles: { label: [label.name], estimate: [est.name], lower: [lo.name], upper: [hi.name] }, params: { scale: ratio ? "ratio (log, ref 1)" : "difference (ref 0)" } }
  },
  ranked_bars: (ds) => {
    const label = labelish(ds).find((c) => X.term.test(c.name))
    const v = nums(ds)[0]
    if (!label || !v) return null
    const g = cols(ds, ["category"]).find((c) => c !== label)
    return { score: 84, roles: { label: [label.name], value: [v.name], group: g ? [g.name] : [] } }
  },
}

// --- runners -----------------------------------------------------------------

function seriesFromColumns(xCol: Column, ys: Column[], opts: RunOptions) {
  const xs = asNums(xCol)
  return replicateSets(ys).map((set) => ({
    name: set.name,
    reps: set.cols.length,
    points: xs
      .flatMap((x, i) => {
        const vals = set.cols.map((c) => c.values[i]).filter((v): v is number => typeof v === "number")
        if (x === null || !vals.length) return []
        const m = mean(vals)
        const e = set.cols.length > 1 ? errHalf(vals, opts.error) : 0
        return [e ? { x, y: m, lo: m - e, hi: m + e } : { x, y: m }]
      })
      .sort((a, b) => a.x - b.x),
  }))
}

const xyChart = (c: Omit<Extract<ChartSpec, { kind: "xy" }>, "kind">): ChartSpec => ({ kind: "xy", ...c })

export const EXTRA_RUN: Record<ExtraId, Runner> = {
  pk: (ds, roles) => {
    const T = role(ds, roles, "time")
    const Cs = roleAll(ds, roles, "conc")
    need(T && Cs.length, "Pick a time column and at least one concentration column.")
    const t = asNums(T!)
    const rows: TableSpec["rows"] = []
    const series: XYSeries[] = Cs.map((c, k) => {
      const pts = sortedPts(t, asNums(c))
      const pos = pts.filter((p) => p.y > 0)
      const cmax = arrMax([...pts.map((p) => p.y)])
      const tmax = pts.find((p) => p.y === cmax)?.x ?? null
      const auc = trapezoid(pts)
      const tail = pos.slice(-3)
      const fit = tail.length === 3 ? linearFit(tail.map((p) => p.x), tail.map((p) => Math.log(p.y))) : null
      const lz = fit && fit.slope < 0 ? -fit.slope : null
      const clast = pos[pos.length - 1]?.y ?? null
      rows.push([c.name, cmax, tmax, auc, lz && clast !== null ? auc + clast / lz : null, lz ? Math.LN2 / lz : null, lz, fit ? fit.r2 : null])
      return { name: c.name, mode: "line+points", color: PALETTE_FOR(k), points: pts }
    })
    return {
      headline: `${Cs.length} profile${Cs.length > 1 ? "s" : ""} · non-compartmental analysis (linear trapezoid; λz from last 3 points)`,
      charts: [xyChart({ title: "Concentration–time profile", xLabel: T!.name, yLabel: Cs.length === 1 ? Cs[0].name : "Concentration", logY: true, series })],
      tables: [{ title: "PK parameters", columns: ["Profile", "Cmax", "Tmax", "AUC0–t", "AUC0–∞", "t½", "λz", "R² (λz)"], rows }],
    }
  },

  growth: (ds, roles, _p, opts) => {
    const T = role(ds, roles, "time")
    const Ys = roleAll(ds, roles, "od")
    need(T && Ys.length, "Pick a time column and growth columns.")
    need(ds.rowCount <= 3000, "Growth curves: at most 3000 time points.")
    const sets = seriesFromColumns(T!, Ys, opts)
    const rows: TableSpec["rows"] = []
    for (const s of sets) {
      const pts = s.points.filter((p) => p.y > 0)
      const w = Math.max(3, Math.round(pts.length / 6))
      let best: { mu: number; a: number; at: number } | null = null
      for (let i = 0; i + w <= pts.length; i++) {
        const win = pts.slice(i, i + w)
        const f = linearFit(win.map((p) => p.x), win.map((p) => Math.log(p.y)))
        if (f && (!best || f.slope > best.mu)) best = { mu: f.slope, a: f.intercept, at: win[Math.floor(w / 2)].x }
      }
      const lag = best && best.mu > 0 ? Math.max(0, (Math.log(pts[0]?.y ?? 1) - best.a) / best.mu) : null
      rows.push([s.name, best?.mu ?? null, best && best.mu > 0 ? Math.LN2 / best.mu : null, lag, arrMax([...s.points.map((p) => p.y)]), trapezoid(s.points), s.reps])
    }
    return {
      headline: `${sets.length} growth curve${sets.length > 1 ? "s" : ""} · µmax from the steepest ${Math.max(3, Math.round((sets[0]?.points.length ?? 0) / 6))}-point window of ln(OD)`,
      charts: [xyChart({ title: "Growth curves", xLabel: T!.name, yLabel: Ys.length === 1 ? Ys[0].name : "OD / growth", series: sets.map((s, k) => ({ name: s.name, mode: "line+points", color: PALETTE_FOR(k), points: s.points })), note: sets.some((s) => s.reps > 1) ? `Mean ± ${errLabel(opts.error)}` : undefined })],
      tables: [{ title: "Growth parameters", columns: ["Curve", "µmax (per time unit)", "Doubling time", "Lag time", "Max", "AUC", "Replicates"], rows }],
    }
  },

  melt: (ds, roles) => {
    const T = role(ds, roles, "temp")
    const Ss = roleAll(ds, roles, "signal")
    need(T && Ss.length, "Pick a temperature column and signal columns.")
    const t = asNums(T!)
    const raw: XYSeries[] = []
    const deriv: XYSeries[] = []
    const rows: TableSpec["rows"] = []
    let firstTm: number | null = null
    Ss.slice(0, 24).forEach((c, k) => {
      const pts = sortedPts(t, asNums(c))
      if (pts.length < 5) return
      const isDeriv = /d.*\/ ?dt|deriv|-d/i.test(c.name)
      // Direction of the main transition: DSF rises to a maximum (then aggregates); qPCR melt falls.
      // Direction of the main transition = sign of the steepest slope (DSF rises; qPCR melt falls).
      const rawD = pts.slice(1, -1).map((p, i) => ({ x: p.x, y: (pts[i + 2].y - pts[i].y) / (pts[i + 2].x - pts[i].x) }))
      const smooth = rawD.map((p, i) => ({ x: p.x, y: mean(rawD.slice(Math.max(0, i - 1), i + 2).map((q) => q.y)) }))
      const steep = smooth.reduce((b, p) => (Math.abs(p.y) > Math.abs(b.y) ? p : b), smooth[0])
      const falling = steep.y < 0
      const d = smooth.map((p) => ({ x: p.x, y: falling ? -p.y : p.y }))
      const iSteep = pts.findIndex((p) => p.x === steep.x)
      let iLo = iSteep
      let iHi = iSteep
      if (falling) {
        for (let k = iSteep; k >= 0; k--) if (pts[k].y >= pts[iHi].y) iHi = k
        for (let k = iSteep; k < pts.length; k++) if (pts[k].y <= pts[iLo].y) iLo = k
      } else {
        for (let k = iSteep; k >= 0; k--) if (pts[k].y <= pts[iLo].y) iLo = k
        for (let k = iSteep; k < pts.length; k++) if (pts[k].y >= pts[iHi].y) iHi = k
      }
      const peakSrc = isDeriv ? pts : d.filter((p) => p.x >= pts[Math.min(iLo, iHi)].x && p.x <= pts[Math.max(iLo, iHi)].x)
      const peak = peakSrc.reduce((b, p) => (p.y > b.y ? p : b), peakSrc[0])
      let tmFit: number | null = null
      if (!isDeriv) {
        const part = falling ? pts.slice(iHi, iLo + 1) : pts.slice(iLo, iHi + 1)
        const lo = arrMin([...part.map((p) => p.y)])
        const hi = arrMax([...part.map((p) => p.y)])
        const half = part.find((p) => (falling ? p.y <= (lo + hi) / 2 : p.y >= (lo + hi) / 2))?.x ?? peak.x
        const width = (part[part.length - 1].x - part[0].x) / 8 || 1
        const f = part.length >= 5 ? fit4PL(part.map((p) => p.x), part.map((p) => p.y), { mid: half, hill: (falling ? -1 : 1) / (width * Math.LN10) }) : null
        if (f && f.logEC50 > pts[0].x && f.logEC50 < pts[pts.length - 1].x && f.r2 > 0.9) tmFit = f.logEC50
      }
      const tm = tmFit ?? peak.x
      if (firstTm === null) firstTm = tm
      raw.push({ name: c.name, mode: "line", color: PALETTE_FOR(k), points: pts })
      if (!isDeriv) deriv.push({ name: c.name, mode: "line", color: PALETTE_FOR(k), points: d })
      rows.push([c.name, tmFit, peak.x, tm - firstTm])
    })
    const charts: ChartSpec[] = [xyChart({ title: "Melt curves", xLabel: T!.name, yLabel: Ss.length === 1 ? Ss[0].name : "Signal", series: raw, refLines: rows.length === 1 ? [{ axis: "x", value: rows[0][3] === 0 ? ((rows[0][1] as number | null) ?? (rows[0][2] as number)) : 0, label: "Tm" }] : [] })]
    if (deriv.length) charts.push(xyChart({ title: "First derivative", xLabel: T!.name, yLabel: "dF/dT (sign set so the transition is a peak)", series: deriv }))
    return {
      headline: `${rows.length} curve${rows.length > 1 ? "s" : ""} · Tm from the sigmoid midpoint of the main transition, or the derivative peak`,
      charts,
      tables: [{ title: "Melting temperatures", columns: ["Curve", "Tm (sigmoid)", "Tm (derivative peak)", "ΔTm vs first"], rows }],
    }
  },

  amplification: (ds, roles, params) => {
    const C = role(ds, roles, "cycle")
    const Rs = roleAll(ds, roles, "rfu")
    need(C && Rs.length, "Pick a cycle column and RFU columns.")
    const cyc = asNums(C!)
    const curves = Rs.map((c) => {
      const pts = sortedPts(cyc, asNums(c))
      const base = pts.filter((p) => p.x >= 3 && p.x <= 15).map((p) => p.y)
      const bm = base.length ? mean(base) : pts[0]?.y ?? 0
      const bsd = base.length > 1 ? summarize(base).sd : 0
      return { name: c.name, pts: pts.map((p) => ({ x: p.x, y: p.y - bm })), bsd }
    })
    const maxAll = arrMax([...curves.flatMap((c) => c.pts.map((p) => p.y))])
    const sdMed = [...curves.map((c) => c.bsd)].sort((a, b) => a - b)[Math.floor(curves.length / 2)] || maxAll * 0.01
    const thr = params.threshold?.startsWith("10%") ? 0.1 * maxAll : Math.max(10 * sdMed, maxAll * 0.02)
    const rows: TableSpec["rows"] = curves.map((c) => {
      const i = c.pts.findIndex((p, k) => k > 0 && p.y >= thr && c.pts[k - 1].y < thr)
      const cq = i > 0 ? c.pts[i - 1].x + ((thr - c.pts[i - 1].y) / (c.pts[i].y - c.pts[i - 1].y)) * (c.pts[i].x - c.pts[i - 1].x) : null
      return [c.name, cq ?? "Undetermined", arrMax([...c.pts.map((p) => p.y)])]
    })
    return {
      headline: `${curves.length} curves · baseline cycles 3–15 · threshold ${fmt(thr)} ΔRFU`,
      charts: [xyChart({ title: "Amplification plot", xLabel: C!.name, yLabel: "ΔRFU (baseline-subtracted)", logY: true, series: curves.map((c, k) => ({ name: c.name, mode: "line", color: PALETTE_FOR(k), points: c.pts.filter((p) => p.y > thr / 30) })), refLines: [{ axis: "y", value: thr, label: "Threshold" }] })],
      tables: [{ title: "Cq values", columns: ["Curve", "Cq", "Max ΔRFU"], rows }],
    }
  },

  chromatogram: (ds, roles, params) => {
    const T = role(ds, roles, "time")
    const S = role(ds, roles, "signal")
    need(T && S, "Pick a retention time column and a signal column.")
    const pts = sortedPts(asNums(T!), asNums(S!))
    need(pts.length >= 20, "Need at least 20 points.")
    const ys = pts.map((p) => p.y)
    const base = [...ys].sort((a, b) => a - b)[Math.floor(ys.length * 0.05)]
    const max = arrMax([...ys]) - base
    const thr = base + (Number(params.minHeight) || 5) / 100 * max
    const w = Math.max(2, Math.round(pts.length / 200))
    const peaks: number[] = []
    for (let i = w; i < pts.length - w; i++) {
      if (ys[i] < thr) continue
      let ok = true
      for (let k = i - w; k <= i + w; k++) if (ys[k] > ys[i] || (ys[k] === ys[i] && k < i)) ok = false
      if (ok) peaks.push(i)
    }
    const bounds = peaks.map((p, j) => {
      const prev = peaks[j - 1]
      const next = peaks[j + 1]
      let l = p
      if (prev !== undefined) for (let k = prev; k < p; k++) l = ys[k] < ys[l] ? k : l
      else while (l > 0 && ys[l - 1] - base > 0.01 * (ys[p] - base)) l--
      let r = p
      if (next !== undefined) for (let k = p; k < next; k++) r = ys[k] < ys[r] ? k : r
      else while (r < pts.length - 1 && ys[r + 1] - base > 0.01 * (ys[p] - base)) r++
      return [l, r] as const
    })
    const areas = bounds.map(([l, r]) => trapezoid(pts.slice(l, r + 1).map((p) => ({ x: p.x, y: Math.max(0, p.y - base) }))))
    const total = areas.reduce((s, a) => s + a, 0) || 1
    return {
      headline: `${peaks.length} peak${peaks.length === 1 ? "" : "s"} above ${params.minHeight || 5}% of max · baseline ${fmt(base)}`,
      charts: [xyChart({ title: "Chromatogram", xLabel: T!.name, yLabel: S!.name, series: [{ name: S!.name, mode: "line", points: pts }, { name: "Peaks", mode: "points", color: "#e0533d", size: 3, hideInLegend: true, points: peaks.map((i, j) => ({ x: pts[i].x, y: pts[i].y, label: String(j + 1) })) }] })],
      tables: [{ title: "Peaks", columns: ["Peak", "Retention", "Height", "Area", "% area", "Start", "End"], rows: peaks.map((i, j) => [j + 1, pts[i].x, ys[i] - base, areas[j], (100 * areas[j]) / total, pts[bounds[j][0]].x, pts[bounds[j][1]].x]) }],
    }
  },

  matrix_heatmap: (ds, roles, params) => {
    const L = role(ds, roles, "label")
    const Vs = roleAll(ds, roles, "values")
    need(L && Vs.length >= 2, "Pick a row-label column and at least two numeric columns.")
    const seen = new Map<string, number>()
    let rows = L!.values.flatMap((lab, i) => {
      const vals = Vs.map((c) => toNumber(c.values[i]))
      if (vals.every((v) => v === null)) return []
      let name = str(lab) ?? `Row ${i + 1}`
      const n = seen.get(name) ?? 0
      seen.set(name, n + 1)
      if (n) name = `${name} (${n + 1})`
      return [{ name, vals }]
    })
    const total = rows.length
    if (params.scale === "log2(x+1)") rows = rows.map((r) => ({ ...r, vals: r.vals.map((v) => (v === null ? null : Math.log2(Math.max(0, v) + 1))) }))
    const spread = (v: (number | null)[]) => {
      const xs = v.filter((x): x is number => x !== null)
      const m = xs.reduce((a, x) => a + x, 0) / (xs.length || 1)
      return xs.reduce((a, x) => a + (x - m) ** 2, 0)
    }
    const top = Number(params.top) || 50
    if (rows.length > top) rows = rows.map((r) => ({ r, v: spread(r.vals) })).sort((a, b) => b.v - a.v).slice(0, top).map((x) => x.r)
    if (params.scale === "row z-score") rows = rows.map((r) => ({ ...r, vals: zscoreRow(r.vals) }))
    let colIdx = Vs.map((_, j) => j)
    const filled = rows.map((r) => r.vals.map((v) => v ?? 0))
    if (params.cluster !== "none" && rows.length >= 3) rows = clusterOrder(filled).map((i) => rows[i])
    if (params.cluster === "rows and columns" && Vs.length >= 3) colIdx = clusterOrder(Vs.map((_, j) => rows.map((r) => r.vals[j] ?? 0)))
    const z = params.scale === "row z-score"
    const lim = z ? Math.min(3, arrMax(rows.flatMap((r) => r.vals.filter((v): v is number => v !== null).map(Math.abs)))) : undefined
    return {
      headline: `${rows.length}${total > rows.length ? ` of ${total} (most variable)` : ""} rows × ${Vs.length} columns · ${params.scale || "row z-score"} · clustering: ${params.cluster || "none"}`,
      charts: [{ kind: "heatmap", title: "Heatmap", rows: rows.map((r) => r.name), cols: colIdx.map((j) => Vs[j].name), values: rows.map((r) => colIdx.map((j) => r.vals[j])), scale: z ? "diverging" : "sequential", domain: z ? [-lim!, lim!] : undefined, legendLabel: z ? "z-score" : params.scale === "log2(x+1)" ? "log2" : "value", showValues: rows.length * Vs.length <= 120 }],
      tables: [{ title: "Values shown", columns: [L!.name, ...colIdx.map((j) => Vs[j].name)], rows: rows.slice(0, 100).map((r) => [r.name, ...colIdx.map((j) => r.vals[j])]) }],
    }
  },

  synergy: (ds, roles, params) => {
    const A = role(ds, roles, "doseA")
    const B = role(ds, roles, "doseB")
    const R = role(ds, roles, "response")
    need(A && B && R, "Pick drug A dose, drug B dose and response.")
    const a = asNums(A!)
    const b = asNums(B!)
    const r = asNums(R!)
    const da = [...new Set(a.filter((v): v is number => v !== null))].sort((x, y) => x - y)
    const db = [...new Set(b.filter((v): v is number => v !== null))].sort((x, y) => x - y)
    need(da.includes(0) && db.includes(0), "Bliss needs single-agent wells: rows where the other drug's dose is 0.")
    const cell = (x: number, y: number) => {
      const v = r.filter((_, i) => a[i] === x && b[i] === y && r[i] !== null) as number[]
      return v.length ? mean(v) : null
    }
    const toFrac = (v: number | null) => (v === null ? null : params.responseIs === "% inhibition" ? v / 100 : (100 - v) / 100)
    const rowsA = [...da].reverse()
    const obs = rowsA.map((x) => db.map((y) => cell(x, y)))
    const bliss = rowsA.map((x) =>
      db.map((y) => {
        if (x === 0 || y === 0) return null
        const ea = toFrac(cell(x, 0))
        const eb = toFrac(cell(0, y))
        const eab = toFrac(cell(x, y))
        return ea === null || eb === null || eab === null ? null : 100 * (eab - (ea + eb - ea * eb))
      }),
    )
    const combos = bliss.flat().filter((v): v is number => v !== null)
    const lim = arrMax([10, ...combos.map(Math.abs)])
    const best = combos.length ? arrMax([...combos]) : null
    return {
      headline: `${da.length - 1} × ${db.length - 1} combinations · mean Bliss excess ${fmt(mean(combos))} (positive = synergy)`,
      charts: [
        { kind: "heatmap", title: `Response (${R!.name})`, rows: rowsA.map(String), cols: db.map(String), values: obs, scale: "sequential", legendLabel: params.responseIs ?? "% viability", showValues: true },
        { kind: "heatmap", title: "Bliss excess (observed − expected)", rows: rowsA.map(String), cols: db.map(String), values: bliss, scale: "diverging", domain: [-lim, lim], legendLabel: "Δ% (+ synergy)", showValues: true },
      ],
      tables: [{ title: "Bliss summary", columns: ["Rows", "Columns", "Mean Bliss excess", "Max Bliss excess", "Combinations > +10", "Combinations < −10"], rows: [[`${A!.name}`, `${B!.name}`, mean(combos), best, combos.filter((v) => v > 10).length, combos.filter((v) => v < -10).length]] }],
    }
  },

  pca: (ds, roles, params) => {
    const Vs = roleAll(ds, roles, "values")
    need(Vs.length >= 2, "Pick at least two numeric columns.")
    let samples: string[]
    let groups: string[]
    let Xm: number[][]
    if (params.orientation === "columns") {
      const complete = Array.from({ length: ds.rowCount }, (_, i) => i).filter((i) => Vs.every((c) => typeof c.values[i] === "number"))
      const vars = complete.filter((i) => summarize(Vs.map((c) => c.values[i] as number)).sd > 0)
      need(vars.length >= 2, "Need at least two rows with values in every selected column.")
      samples = names(Vs)
      const reps = replicateSets(Vs)
      groups = Vs.map((c) => reps.find((r) => r.cols.includes(c))?.name ?? c.name)
      Xm = Vs.map((c) => vars.map((i) => c.values[i] as number))
      const flat = Xm.flat()
      if (flat.every((v) => v >= 0) && arrMax([...flat]) > 100) Xm = Xm.map((r) => r.map((v) => Math.log2(v + 1)))
    } else {
      const G = role(ds, roles, "group")
      const Lb = role(ds, roles, "label")
      const complete = Array.from({ length: ds.rowCount }, (_, i) => i).filter((i) => Vs.every((c) => typeof c.values[i] === "number"))
      need(complete.length >= 3, "Need at least three rows with values in every selected column.")
      samples = complete.map((i) => (Lb ? str(Lb.values[i]) ?? `Row ${i + 1}` : `Row ${i + 1}`))
      groups = complete.map((i) => (G ? str(G.values[i]) ?? "—" : "All"))
      Xm = complete.map((i) => Vs.map((c) => c.values[i] as number))
    }
    const res = pca(Xm, 3, params.orientation !== "columns")
    const lv = [...new Set(groups)]
    const pct = (k: number) => `${(100 * (res.explained[k] ?? 0)).toFixed(1)}%`
    const labelPts = samples.length <= 40
    const charts: ChartSpec[] = [
      xyChart({ title: "PCA score plot", xLabel: `PC1 (${pct(0)})`, yLabel: `PC2 (${pct(1)})`, series: lv.map((g, k) => ({ name: g, mode: "points", color: PALETTE_FOR(k), size: 4.5, points: res.scores.flatMap((s, i) => (groups[i] === g ? [{ x: s[0], y: s[1] ?? 0, label: labelPts ? samples[i] : undefined }] : [])) })), refLines: [{ axis: "x", value: 0 }, { axis: "y", value: 0 }] }),
      { kind: "bars", title: "Scree plot", valueLabel: "% variance explained", labels: res.explained.slice(0, 10).map((_, k) => `PC${k + 1}`), values: res.explained.slice(0, 10).map((v) => 100 * v), orientation: "vertical", mark: "bar" } as BarsSpec,
    ]
    const tables: TableSpec[] = [{ title: "Variance explained", columns: ["Component", "% variance", "Cumulative %"], rows: res.explained.slice(0, 10).map((v, k) => [`PC${k + 1}`, 100 * v, 100 * res.explained.slice(0, k + 1).reduce((s, x) => s + x, 0)]) }]
    if (res.loadings) tables.push({ title: "Loadings", columns: ["Variable", "PC1", "PC2", "PC3"], rows: Vs.map((c, j) => [c.name, res.loadings![0]?.[j] ?? null, res.loadings![1]?.[j] ?? null, res.loadings![2]?.[j] ?? null]) })
    tables.push({ title: "Scores", columns: ["Sample", "Group", "PC1", "PC2", "PC3"], rows: res.scores.slice(0, 200).map((s, i) => [samples[i], groups[i], s[0], s[1] ?? null, s[2] ?? null]) })
    return { headline: `${samples.length} samples × ${Xm[0].length} variables · PC1 ${pct(0)}, PC2 ${pct(1)}${params.orientation === "columns" ? " · samples = columns (groups from column names; counts log2-transformed)" : " · standardized"}`, charts, tables }
  },

  scatter_groups: (ds, roles) => {
    const Xc = role(ds, roles, "x")
    const Yc = role(ds, roles, "y")
    const G = role(ds, roles, "group")
    need(Xc && Yc, "Pick X and Y columns.")
    const xs = asNums(Xc!)
    const ys = asNums(Yc!)
    const lv = G ? levelsOf(G) : ["All"]
    need(lv.length <= 40, "Color column has too many values (max 40).")
    const series: XYSeries[] = lv.map((g, k) => ({ name: g, mode: "points", color: PALETTE_FOR(k), size: 2.6, points: xs.flatMap((x, i) => (x !== null && ys[i] !== null && (!G || str(G.values[i]) === g) ? [{ x, y: ys[i]! }] : [])) }))
    const n = series.reduce((s, x) => s + x.points.length, 0)
    return {
      headline: `${n} points${G ? ` · ${lv.length} groups by “${G.name}”` : ""}`,
      charts: [xyChart({ title: `${Yc!.name} vs ${Xc!.name}`, xLabel: Xc!.name, yLabel: Yc!.name, series })],
      tables: [{ title: "Points per group", columns: ["Group", "N", "% of total", `Median ${Xc!.name}`, `Median ${Yc!.name}`], rows: series.map((s) => [s.name, s.points.length, (100 * s.points.length) / (n || 1), summarize(s.points.map((p) => p.x)).median, summarize(s.points.map((p) => p.y)).median]) }],
    }
  },

  ma_plot: (ds, roles, params) => {
    const A = role(ds, roles, "a")
    const F = role(ds, roles, "fc")
    const P = role(ds, roles, "p")
    need(A && F, "Pick mean expression and log2 fold change.")
    const cut = Number(params.pCutoff) || 0.05
    const logX = numbersOf(A!).every((v) => v >= 0) && arrMax([...numbersOf(A!)]) > 50
    const pts = A!.values.flatMap((a, i) => {
      const x = toNumber(a)
      const y = toNumber(F!.values[i])
      if (x === null || y === null || (logX && x <= 0)) return []
      const p = P ? toNumber(P.values[i]) : null
      const sig = P ? p !== null && p < cut : Math.abs(y) >= 1
      return [{ x, y, cls: sig ? (y > 0 ? "up" : "down") : "ns" }]
    })
    const by = (c: string) => pts.filter((p) => p.cls === c).map(({ x, y }) => ({ x, y }))
    return {
      headline: `${pts.length} features · ${by("up").length} up · ${by("down").length} down (${P ? `P < ${cut}` : "|log2FC| ≥ 1"})`,
      charts: [xyChart({ title: "MA plot", xLabel: logX ? `${A!.name} (log scale)` : A!.name, yLabel: F!.name, logX, series: [{ name: "Not significant", mode: "points", color: "#b8bcc4", size: 2.2, points: by("ns") }, { name: "Down", mode: "points", color: "#2f6fdb", size: 2.8, points: by("down") }, { name: "Up", mode: "points", color: "#e0533d", size: 2.8, points: by("up") }], refLines: [{ axis: "y", value: 0 }] })],
      tables: [{ title: "Counts", columns: ["Class", "N"], rows: [["Up", by("up").length], ["Down", by("down").length], ["Not significant", by("ns").length]] }],
    }
  },

  qpcr_standard: (ds, roles) => {
    const Q = role(ds, roles, "quantity")
    const CTs = roleAll(ds, roles, "ct")
    const Pr = role(ds, roles, "primer")
    need(Q && CTs.length, "Pick the quantity column and Ct column(s).")
    const q = asNums(Q!)
    const ctMean = Array.from({ length: ds.rowCount }, (_, i) => {
      const v = CTs.map((c) => c.values[i]).filter((x): x is number => typeof x === "number")
      return v.length ? mean(v) : null
    })
    const lv = Pr ? levelsOf(Pr) : ["Standard curve"]
    const series: XYSeries[] = []
    const fitRows: TableSpec["rows"] = []
    const unkRows: TableSpec["rows"] = []
    const effs: { name: string; e: number }[] = []
    lv.forEach((g, k) => {
      const idx = q.map((_, i) => i).filter((i) => !Pr || str(Pr.values[i]) === g)
      const std = idx.flatMap((i) => (q[i] !== null && q[i]! > 0 ? CTs.flatMap((c) => (typeof c.values[i] === "number" ? [{ x: q[i]!, y: c.values[i] as number }] : [])) : []))
      if (std.length < 3) return
      const f = linearFit(std.map((p) => Math.log10(p.x)), std.map((p) => p.y))
      if (!f) return
      const eff = 10 ** (-1 / f.slope) - 1
      effs.push({ name: g, e: 100 * eff })
      const xr = [arrMin([...std.map((p) => p.x)]), arrMax([...std.map((p) => p.x)])]
      series.push({ name: g, mode: "points", color: PALETTE_FOR(k), points: std })
      series.push({ name: `${g} fit`, mode: "line", color: PALETTE_FOR(k), hideInLegend: true, points: xr.map((x) => ({ x, y: f.intercept + f.slope * Math.log10(x) })) })
      fitRows.push([g, f.slope, f.intercept, f.r2, 100 * eff, `${fmt(xr[0])} – ${fmt(xr[1])}`, std.length])
      idx.filter((i) => q[i] === null && ctMean[i] !== null).forEach((i) => unkRows.push([g, `Row ${i + 1}`, ctMean[i], 10 ** ((ctMean[i]! - f.intercept) / f.slope)]))
    })
    need(fitRows.length, "Need at least 3 standards with a quantity > 0.")
    const charts: ChartSpec[] = [xyChart({ title: "qPCR standard curve", xLabel: `${Q!.name} (log scale)`, yLabel: "Ct", logX: true, series, note: fitRows.length === 1 ? `Slope ${fmt(fitRows[0][1] as number)}, R² ${fmt(fitRows[0][3] as number, 4)}, efficiency ${fmt(fitRows[0][4] as number)}%` : undefined })]
    if (effs.length >= 2) charts.push({ kind: "bars", title: "Primer efficiency", valueLabel: "Efficiency (%)", labels: effs.map((e) => e.name), values: effs.map((e) => e.e), colors: effs.map((e) => (e.e >= 90 && e.e <= 110 ? "#2a9d6f" : "#e0533d")), orientation: "vertical", mark: "bar", refLines: [{ value: 90, label: "90%" }, { value: 110, label: "110%" }], note: "Green = within 90–110%" })
    const tables: TableSpec[] = [{ title: "Standard curve fit (Ct vs log10 quantity)", columns: ["Curve", "Slope", "Intercept", "R²", "Efficiency (%)", "Range", "N"], rows: fitRows }]
    if (unkRows.length) tables.push({ title: "Interpolated unknowns", columns: ["Curve", "Sample", "Mean Ct", `Quantity (${Q!.name})`], rows: unkRows })
    return { headline: `${fitRows.length} standard curve${fitRows.length > 1 ? "s" : ""} · efficiency = 10^(−1/slope) − 1`, charts, tables }
  },

  zprime: (ds, roles, params) => {
    const Tp = role(ds, roles, "type")
    const S = role(ds, roles, "signal")
    const B = role(ds, roles, "batch")
    need(Tp && S, "Pick the control-type column and the signal column.")
    need(params.positive && params.negative && params.positive !== params.negative, "Choose different positive and negative controls.")
    const batches = B ? levelsOf(B) : ["All"]
    need(batches.length <= 60, "Batch column has too many values.")
    const vals = (lev: string, b: string) => S!.values.flatMap((v, i) => (typeof v === "number" && str(Tp!.values[i]) === lev && (!B || str(B.values[i]) === b) ? [v] : []))
    const rows: TableSpec["rows"] = []
    const z: number[] = []
    for (const b of batches) {
      const p = summarize(vals(params.positive, b))
      const n = summarize(vals(params.negative, b))
      const zp = p.n > 1 && n.n > 1 ? 1 - (3 * (p.sd + n.sd)) / Math.abs(p.mean - n.mean) : NaN
      z.push(zp)
      rows.push([b, p.n, n.n, p.mean, n.mean, zp, n.mean !== 0 ? p.mean / n.mean : null, n.sd > 0 ? (p.mean - n.mean) / n.sd : null, (100 * p.sd) / Math.abs(p.mean), (100 * n.sd) / Math.abs(n.mean), zp >= 0.5 ? "Excellent" : zp > 0 ? "Marginal" : "Fail"])
    }
    return {
      headline: `${batches.length} batch${batches.length > 1 ? "es" : ""} · Z′ = 1 − 3(σ+ + σ−)/|µ+ − µ−| · ${z.filter((v) => v >= 0.5).length} ≥ 0.5`,
      charts: [
        { kind: "bars", title: "Z′-factor", valueLabel: "Z′", labels: batches, values: z.map((v) => (Number.isFinite(v) ? v : 0)), colors: z.map((v) => (v >= 0.5 ? "#2a9d6f" : v > 0 ? "#e39b22" : "#e0533d")), orientation: "vertical", mark: "bar", refLines: [{ value: 0.5, label: "0.5 (excellent)" }, { value: 0 }] },
        { kind: "column", title: "Control wells", yLabel: S!.name, style: "scatter", error: "sd", groups: batches.flatMap((b) => [{ name: batches.length > 1 ? `${b} ${params.positive}` : params.positive, values: vals(params.positive, b) }, { name: batches.length > 1 ? `${b} ${params.negative}` : params.negative, values: vals(params.negative, b) }]).slice(0, 24), test: null },
      ],
      tables: [{ title: "Assay quality", columns: ["Batch", "N +", "N −", "Mean +", "Mean −", "Z′", "S/B", "S/N", "%CV +", "%CV −", "Verdict"], rows }],
    }
  },

  waterfall: (ds, roles) => {
    const Ch = role(ds, roles, "change")
    const B0 = role(ds, roles, "baseline")
    const B1 = role(ds, roles, "followup")
    const G = role(ds, roles, "group")
    const L = role(ds, roles, "label")
    need(Ch || (B0 && B1), "Pick a % change column, or baseline and follow-up columns.")
    const items = Array.from({ length: ds.rowCount }, (_, i) => {
      const v = Ch ? toNumber(Ch.values[i]) : (() => { const a = toNumber(B0!.values[i]); const b = toNumber(B1!.values[i]); return a && b !== null ? (100 * (b - a)) / a : null })()
      return v === null ? null : { v, label: L ? str(L.values[i]) ?? `#${i + 1}` : `#${i + 1}`, g: G ? str(G.values[i]) ?? "—" : null }
    }).filter((x): x is { v: number; label: string; g: string | null } => !!x).sort((a, b) => b.v - a.v)
    const lv = G ? levelsOf(G) : []
    const cat = (v: number) => (v >= 20 ? "Progression (≥ +20%)" : v <= -30 ? "Response (≤ −30%)" : "Stable")
    const catColor: Record<string, string> = { "Progression (≥ +20%)": "#e0533d", "Response (≤ −30%)": "#2f6fdb", Stable: "#9aa0a6" }
    const colors = items.map((it) => (G ? PALETTE_FOR(lv.indexOf(it.g!)) : catColor[cat(it.v)]))
    const counts = Object.keys(catColor).map((k) => [k, items.filter((it) => cat(it.v) === k).length, (100 * items.filter((it) => cat(it.v) === k).length) / (items.length || 1)])
    return {
      headline: `${items.length} subjects · ${counts[1][1]} with ≥ 30% decrease`,
      charts: [{ kind: "bars", title: "Waterfall plot", valueLabel: Ch ? Ch.name : "% change from baseline", labels: items.map((it) => it.label), values: items.map((it) => it.v), colors, orientation: "vertical", mark: "bar", refLines: [{ value: 20, label: "+20%" }, { value: -30, label: "−30%" }], legend: G ? lv.map((g, k) => ({ name: g, color: PALETTE_FOR(k) })) : Object.entries(catColor).map(([name, color]) => ({ name, color })) }],
      tables: [{ title: "Response categories", columns: ["Category", "N", "%"], rows: counts }],
    }
  },

  forest: (ds, roles, params) => {
    const L = role(ds, roles, "label")
    const E = role(ds, roles, "estimate")
    const Lo = role(ds, roles, "lower")
    const Hi = role(ds, roles, "upper")
    need(L && E && Lo && Hi, "Pick label, estimate, lower and upper CI columns.")
    const ratio = params.scale !== "difference (ref 0)"
    const ref = ratio ? 1 : 0
    const rows = Array.from({ length: ds.rowCount }, (_, i) => ({ l: str(L!.values[i]) ?? `Row ${i + 1}`, e: toNumber(E!.values[i]), lo: toNumber(Lo!.values[i]), hi: toNumber(Hi!.values[i]) })).filter((r) => r.e !== null && (!ratio || r.e > 0))
    return {
      headline: `${rows.length} estimates · ${ratio ? "ratio scale (log), reference 1" : "difference scale, reference 0"} · ${rows.filter((r) => r.lo !== null && r.hi !== null && (r.hi < ref || r.lo > ref)).length} exclude the reference`,
      charts: [{ kind: "bars", title: "Forest plot", valueLabel: E!.name, labels: rows.map((r) => r.l), values: rows.map((r) => r.e!), lo: rows.map((r) => r.lo), hi: rows.map((r) => r.hi), colors: rows.map((r) => (r.lo !== null && r.hi !== null && (r.hi < ref || r.lo > ref) ? "#e0533d" : "#2f6fdb")), orientation: "horizontal", mark: "point", logScale: ratio, refLines: [{ value: ref }] }],
      tables: [{ title: "Estimates", columns: [L!.name, E!.name, "95% CI", "Excludes reference"], rows: rows.map((r) => [r.l, r.e, `${fmt(r.lo ?? NaN)} – ${fmt(r.hi ?? NaN)}`, r.lo !== null && r.hi !== null && (r.hi < ref || r.lo > ref) ? "Yes" : "No"]) }],
    }
  },

  ranked_bars: (ds, roles, params) => {
    const L = role(ds, roles, "label")
    const V = role(ds, roles, "value")
    const G = role(ds, roles, "group")
    need(L && V, "Pick a label column and a score column.")
    const top = Number(params.top) || 25
    const items = L!.values.flatMap((l, i) => { const v = toNumber(V!.values[i]); return v === null ? [] : [{ l: str(l) ?? `Row ${i + 1}`, v, g: G ? str(G.values[i]) : null }] }).sort((a, b) => b.v - a.v)
    const shown = items.slice(0, top)
    const lv = G ? levelsOf(G) : []
    return {
      headline: `Top ${shown.length} of ${items.length} by ${V!.name}`,
      charts: [{ kind: "bars", title: `Top ${shown.length} by ${V!.name}`, valueLabel: V!.name, labels: shown.map((s) => s.l), values: shown.map((s) => s.v), colors: shown.map((s) => (G ? PALETTE_FOR(lv.indexOf(s.g ?? "")) : PALETTE_FOR(0))), orientation: "horizontal", mark: "bar", legend: G ? lv.map((g, k) => ({ name: g, color: PALETTE_FOR(k) })) : undefined }],
      tables: [{ title: "Ranked", columns: ["Rank", L!.name, V!.name, ...(G ? [G.name] : [])], rows: shown.map((s, i) => [i + 1, s.l, s.v, ...(G ? [s.g] : [])]) }],
    }
  },
}

export { byName, fourPL }
