/**
 * Detect + run for every analysis in analysis-defs.ts. Detection scores how
 * well a dataset fits each analysis and proposes column roles; running turns a
 * dataset + roles into chart and table specs. No AI involved.
 */
import { ANALYSES, analysisById, type AnalysisId } from "./analysis-defs"
import { numbersOf, toNumber, type Column, type Dataset } from "./parse"
import type { ChartSpec, TableSpec, XYPoint, XYSeries } from "./specs"
import {
  chiSquareTest,
  fisherExact,
  fit4PL,
  fitMichaelisMenten,
  fmt,
  fmtP,
  fourPL,
  kaplanMeier,
  linearFit,
  logRank,
  mean,
  normalPdf,
  pairedT,
  pearson,
  rmAnova,
  spearman,
  stars,
  summarize,
  tTwoSidedP,
  twoWayAnova,
} from "./stats"

import {
  RE, cols, byName, role, roleAll, str, levelsOf, isMonotonic, isInteger, names, errHalf, errLabel, replicateSets,
  descriptiveTable, testsTable, compareGroups, need, PALETTE_FOR, normalizeGroups,
  type Roles, type Params, type RunOptions, type Result,
} from "./helpers"
export { levelsOf, replicateSets, descriptiveTable } from "./helpers"
export type { Roles, Params, RunOptions, Result } from "./helpers"
import { EXTRA_DETECT, EXTRA_RUN } from "./analyses-extra"
export type Detection = { id: AnalysisId; score: number; roles: Roles; params: Params }

// --- detection ---------------------------------------------------------------

type Detector = (ds: Dataset) => { score: number; roles: Roles; params?: Params } | null

const DETECT: Record<AnalysisId, Detector> = {
  ...EXTRA_DETECT,
  column: (ds) => {
    const num = cols(ds, ["number"])
    if (!num.length) return null
    const hasFactor = cols(ds, ["category"]).length > 0
    return { score: hasFactor ? 10 : ds.rowCount <= 24 ? 40 + (num.length >= 2 ? 5 : 0) : 25, roles: { values: names(num) } }
  },
  one_factor: (ds) => {
    const g = cols(ds, ["category"]).find((c) => levelsOf(c).length >= 2 && levelsOf(c).length <= 24)
    const num = cols(ds, ["number"])
    if (!g || !num.length) return null
    const div = num.length >= 2 ? num.find((c) => /actin|gapdh|tubulin|loading|renilla|vinculin|total protein|hsp90|housekeeping/i.test(c.name)) : undefined
    return { score: 60, roles: { group: [g.name], values: names(num.filter((c) => c !== div)), normalizer: div ? [div.name] : [] } }
  },
  paired: (ds) => {
    const num = cols(ds, ["number"])
    const named = num.filter((c) => RE.paired.test(c.name))
    const subject = ds.columns.find((c) => RE.subject.test(c.name) && c.kind !== "date")
    const values = (named.length >= 2 ? named : num).filter((c) => c !== subject)
    if (values.length < 2) return null
    // Same subjects measured repeatedly means the columns share a scale (not Age vs CRP vs BMI).
    const means = values.map((c) => Math.abs(summarize(numbersOf(c)).mean)).filter((m) => m > 0)
    const sameScale = means.length >= 2 && Math.max(...means) / Math.min(...means) < 3
    const score = named.length >= 2 ? 72 : subject && sameScale && values.length <= 8 && !cols(ds, ["category"]).filter((c) => c !== subject).length ? 55 : 15
    return { score, roles: { values: names(values), subject: subject ? [subject.name] : [] } }
  },
  two_way: (ds) => {
    const f = ds.columns.filter((c) => c.kind === "category" && levelsOf(c).length <= 24)
    const num = cols(ds, ["number"]).filter((c) => !RE.ct.test(c.name))
    if (f.length < 2 || !num.length) return null
    return { score: 75, roles: { factorA: [f[0].name], factorB: [f[1].name], value: [num[0].name] } }
  },
  summary_bars: (ds) => {
    const m = ds.columns.find((c) => c.kind === "number" && RE.mean.test(c.name))
    const label = ds.columns.find((c) => c.kind === "text" || c.kind === "category")
    if (!m || !label) return null
    const e = ds.columns.find((c) => c.kind === "number" && RE.err.test(c.name))
    const n = ds.columns.find((c) => c.kind === "number" && RE.n.test(c.name))
    return { score: e ? 90 : 60, roles: { label: [label.name], mean: [m.name], error: e ? [e.name] : [], n: n ? [n.name] : [] }, params: { errorType: e && /sem|se\b|s\.e/i.test(e.name) ? "sem" : "sd" } }
  },
  xy: (ds) => {
    const date = cols(ds, ["date"])[0]
    const num = cols(ds, ["number"])
    const x = date ?? (num.length >= 2 && ds.columns[0] === num[0] && isMonotonic(num[0]) ? num[0] : undefined)
    if (!x) return num.length >= 2 ? { score: 5, roles: { x: [num[0].name], y: names(num.slice(1)) } } : null
    const ys = num.filter((c) => c !== x)
    if (!ys.length) return null
    return { score: 60 + (RE.time.test(x.name) ? 8 : 0), roles: { x: [x.name], y: names(ys) } }
  },
  time_course: (ds) => {
    const num = cols(ds, ["number"])
    const x = num.find((c) => RE.time.test(c.name) && levelsOf(c).length < c.values.length * 0.7) ?? cols(ds, ["date"]).find((c) => levelsOf(c).length < c.values.length * 0.7)
    if (!x) return null
    const value = num.find((c) => c !== x && !RE.event.test(c.name))
    if (!value) return null
    const g = cols(ds, ["category"])[0]
    return { score: 78, roles: { x: [x.name], value: [value.name], group: g ? [g.name] : [] } }
  },
  dose_response: (ds) => {
    const num = cols(ds, ["number"])
    const dose = num.find((c) => RE.dose.test(c.name) && !/-\s*log|log10\s*\(?\s*p|\bp\b|p.?val|padj|fdr/i.test(c.name))
    if (!dose) return null
    const resp = num.filter((c) => c !== dose)
    if (!resp.length || resp.every((c) => RE.signal.test(c.name)) && dose.values.some((v) => v === null)) return null
    const g = cols(ds, ["category"])[0]
    return { score: 82, roles: { dose: [dose.name], response: g ? [resp[0].name] : names(resp), group: g ? [g.name] : [] } }
  },
  standard_curve: (ds) => {
    const num = cols(ds, ["number"])
    const sample = ds.columns.find((c) => (c.kind === "text" || c.kind === "category") && c.values.some((v) => typeof v === "string" && RE.standardWord.test(v)))
    const conc = num.find((c) => RE.dose.test(c.name) && c.values.some((v) => v === null) && numbersOf(c).length >= 3)
    if (!conc) return null
    const signal = num.filter((c) => c !== conc && (RE.signal.test(c.name) || num.length <= 4))
    if (!signal.length) return null
    return { score: sample || signal.some((c) => RE.signal.test(c.name)) ? 88 : 70, roles: { conc: [conc.name], signal: names(signal), sample: sample ? [sample.name] : [] } }
  },
  kinetics: (ds) => {
    const num = cols(ds, ["number"])
    const s = num.find((c) => RE.substrate.test(c.name))
    const v = num.filter((c) => c !== s && RE.velocity.test(c.name))
    if (!s || !v.length) return null
    return { score: 85, roles: { substrate: [s.name], velocity: names(v) } }
  },
  survival: (ds) => {
    const time = cols(ds, ["number"]).find((c) => RE.time.test(c.name))
    const event = ds.columns.find((c) => c !== time && RE.event.test(c.name) && (c.kind !== "number" || numbersOf(c).every((v) => v === 0 || v === 1)))
    if (!time || !event) return null
    const g = ds.columns.find((c) => c.kind === "category" && c !== event)
    return { score: 92, roles: { time: [time.name], event: [event.name], group: g ? [g.name] : [] } }
  },
  contingency: (ds) => {
    const cats = cols(ds, ["category"])
    const num = cols(ds, ["number"])
    if (cats.length >= 2 && !num.length) return { score: 75, roles: { rows: [cats[0].name], cols: [cats[1].name], counts: [] } }
    const label = ds.columns.find((c) => c.kind === "text" || c.kind === "category")
    const counts = num.filter(isInteger)
    if (label && counts.length >= 2 && counts.length === num.length && ds.rowCount <= 20) return { score: counts.some((c) => /yes|no|pos|neg|alive|dead|respon|count|^n$|present|absent|male|female/i.test(c.name)) ? 70 : 35, roles: { rows: [label.name], cols: [], counts: names(counts) } }
    return null
  },
  parts: (ds) => {
    const label = ds.columns.find((c) => (c.kind === "text" || c.kind === "category") && levelsOf(c).length === c.values.filter((v) => v !== null).length)
    const num = cols(ds, ["number"])
    if (!label || num.length !== 1 || ds.rowCount > 15 || numbersOf(num[0]).some((v) => v < 0)) return null
    return { score: 50 + (RE.percent.test(num[0].name) ? 15 : 0), roles: { label: [label.name], value: [num[0].name] }, params: { shape: "donut" } }
  },
  histogram: (ds) => {
    const num = cols(ds, ["number"])
    if (!num.length) return null
    const g = cols(ds, ["category"])[0]
    return { score: num.length === 1 && numbersOf(num[0]).length >= 30 ? (g ? 50 : 70) : 3, roles: { value: [num[0].name], group: g ? [g.name] : [] } }
  },
  correlation: (ds) => {
    const num = cols(ds, ["number"])
    if (num.length < 2) return null
    const rows = ds.rowCount
    return { score: num.length >= 3 && rows >= 8 && !cols(ds, ["category"]).length ? 42 : rows >= 8 ? 30 : 4, roles: { values: names(num.slice(0, 12)) } }
  },
  bland_altman: (ds) => {
    const num = cols(ds, ["number"])
    const m = num.filter((c) => RE.method.test(c.name))
    const pick = m.length >= 2 ? m : num
    if (pick.length < 2) return null
    return { score: m.length >= 2 ? 65 : 2, roles: { a: [pick[0].name], b: [pick[1].name] } }
  },
  qpcr: (ds) => {
    const ct = cols(ds, ["number"]).find((c) => RE.ct.test(c.name))
    const factors = ds.columns.filter((c) => c.kind === "category" || c.kind === "text")
    if (!ct || factors.length < 2) return null
    const target = factors.find((c) => /gene|target|primer|assay/i.test(c.name)) ?? factors.find((c) => levelsOf(c).some((l) => RE.refGene.test(l))) ?? factors[0]
    const sample = factors.find((c) => c !== target && /sample|condition|group|treat/i.test(c.name)) ?? factors.find((c) => c !== target)!
    const ref = levelsOf(target).find((l) => RE.refGene.test(l)) ?? levelsOf(target)[0]
    const control = levelsOf(sample).find((l) => RE.control.test(l)) ?? levelsOf(sample)[0]
    return { score: 95, roles: { target: [target.name], sample: [sample.name], ct: [ct.name] }, params: { reference: ref, control } }
  },
  plate: (ds) => {
    const first = ds.columns[0]
    const letters = first && first.kind !== "number" ? levelsOf(first) : []
    const num = cols(ds, ["number"])
    if (letters.length >= 4 && letters.every((l) => /^[A-Pa-p]$/.test(l)) && num.length >= 6) return { score: 96, roles: { rowLabel: [first.name], well: [], values: names(num) } }
    const looksLikeWells = (c: Column) => {
      const lv = levelsOf(c)
      if (!lv.every((l) => /^[A-Pa-p]\d{1,2}$/.test(l))) return false
      const letters = new Set(lv.map((l) => l[0].toUpperCase()))
      const maxCol = Math.max(...lv.map((l) => Number(l.slice(1))))
      return lv.length >= 24 && letters.size >= 3 && maxCol <= 24
    }
    const well = ds.columns.find((c) => c.kind !== "number" && (RE.well.test(c.name) ? levelsOf(c).length >= 6 : looksLikeWells(c)))
    if (well && num.length) return { score: 90, roles: { rowLabel: [], well: [well.name], values: [num[0].name] } }
    return null
  },
  volcano: (ds) => {
    const num = cols(ds, ["number"])
    const fc = num.find((c) => RE.fc.test(c.name))
    const p = [...num].reverse().find((c) => c !== fc && RE.p.test(c.name))
    if (!fc || !p) return null
    const label = ds.columns.find((c) => c.kind === "text" || c.kind === "category")
    return { score: 93, roles: { fc: [fc.name], p: [p.name], label: label ? [label.name] : [] }, params: { fcCutoff: "1", pCutoff: "0.05" } }
  },
}

/** Generic role guess so every analysis can be picked by hand. */
function guessRoles(ds: Dataset, id: AnalysisId): Roles {
  const def = analysisById(id)!
  const used = new Set<string>()
  const roles: Roles = {}
  for (const r of def.roles) {
    const fits = ds.columns.filter((c) => r.kinds.includes(c.kind) && !used.has(c.name))
    const pick = r.multiple ? fits : fits.slice(0, 1)
    if (r.optional && !r.multiple) {
      roles[r.key] = []
      continue
    }
    pick.forEach((c) => used.add(c.name))
    roles[r.key] = names(pick)
  }
  return roles
}

export function defaultParams(ds: Dataset, id: AnalysisId, roles: Roles): Params {
  const def = analysisById(id)!
  const p: Params = {}
  for (const param of def.params ?? []) {
    if (param.columnsOf) {
      const chosen = roles[param.columnsOf] ?? []
      p[param.key] = chosen.find((n) => RE.control.test(n) || /control|ctrl|vehicle|untreated|wt/i.test(n)) ?? chosen[0] ?? ""
    } else if (param.levelsOf) {
      const c = role(ds, roles, param.levelsOf)
      const lv = c ? levelsOf(c) : []
      p[param.key] = (param.key === "reference" ? lv.find((l) => RE.refGene.test(l)) : param.key === "control" ? lv.find((l) => RE.control.test(l)) : undefined) ?? lv[0] ?? ""
    } else p[param.key] = param.default ?? param.values?.[0] ?? ""
  }
  return p
}

/** Every analysis with a fit score, best first. */
export function detectAll(ds: Dataset): Detection[] {
  return ANALYSES.map((a) => {
    const d = DETECT[a.id](ds)
    const roles = d?.roles ?? guessRoles(ds, a.id)
    return { id: a.id, score: d?.score ?? 0, roles, params: { ...defaultParams(ds, a.id, roles), ...(d?.params ?? {}) } }
  }).sort((x, y) => y.score - x.score)
}

// --- runners -----------------------------------------------------------------

type Runner = (ds: Dataset, roles: Roles, params: Params, opts: RunOptions) => Result


const RUN: Record<AnalysisId, Runner> = {
  ...EXTRA_RUN,
  column: (ds, roles, params, opts) => {
    const vs = roleAll(ds, roles, "values")
    need(vs.length, "Pick at least one numeric column.")
    const norm = normalizeGroups(vs.map((c) => ({ name: c.name, values: numbersOf(c) })), params.normalize, params.control)
    const out: Result = { headline: `${vs.length} group${vs.length > 1 ? "s" : ""} (each column = one group)${norm.label ? ` · ${norm.label}` : ""}`, charts: [], tables: [] }
    compareGroups(vs.length === 1 ? vs[0].name : "Column comparison", norm.label || (vs.length === 1 ? vs[0].name : "Value"), norm.groups, opts, out)
    return out
  },

  one_factor: (ds, roles, params, opts) => {
    const g = role(ds, roles, "group")
    const div = role(ds, roles, "normalizer")
    const vs = roleAll(ds, roles, "values").filter((c) => c !== div)
    need(g && vs.length, "Pick a group column and at least one measurement.")
    const lv = levelsOf(g!)
    need(lv.length <= 50, `“${g!.name}” has ${lv.length} different values — pick a group column with at most 50.`)
    const notes = [div ? `÷ ${div.name}` : "", params.normalize && params.normalize !== "none" ? `${params.normalize} (${params.control})` : ""].filter(Boolean)
    const out: Result = { headline: `Grouped by “${g!.name}” (${lv.length} groups)${notes.length ? ` · ${notes.join(", ")}` : ""}`, charts: [], tables: [] }
    for (const m of vs.slice(0, 6)) {
      const value = (i: number) => {
        const v = m.values[i]
        if (typeof v !== "number") return null
        if (!div) return v
        const d = toNumber(div.values[i])
        return d ? v / d : null
      }
      const raw = lv.map((level) => ({ name: level, values: m.values.flatMap((_, i) => { const v = str(g!.values[i]) === level ? value(i) : null; return v === null ? [] : [v] }) }))
      const norm = normalizeGroups(raw, params.normalize, params.control)
      const name = div ? `${m.name} / ${div.name}` : m.name
      compareGroups(name, norm.label ? `${name} (${norm.label})` : name, norm.groups, opts, out)
    }
    return out
  },

  paired: (ds, roles, _p, opts) => {
    const vs = roleAll(ds, roles, "values")
    need(vs.length >= 2, "Pick at least two columns measured on the same subjects.")
    const complete = Array.from({ length: ds.rowCount }, (_, i) => i).filter((i) => vs.every((c) => typeof c.values[i] === "number"))
    const groups = vs.map((c) => ({ name: c.name, values: complete.map((i) => c.values[i] as number) }))
    const test = vs.length === 2 ? pairedT(groups[0].values, groups[1].values) : rmAnova(groups.map((g) => g.values))
    const out: Result = { headline: `${complete.length} subjects with complete data · ${vs.length} paired measurements`, charts: [], tables: [] }
    out.charts.push({ kind: "column", title: "Before–after", yLabel: "Value", style: opts.style === "bar" ? "scatter" : opts.style, error: opts.error, groups, test, paired: true })
    if (vs.length === 2) {
      const diffs = groups[0].values.map((v, i) => groups[1].values[i] - v)
      out.charts.push({ kind: "column", title: `Difference (${vs[1].name} − ${vs[0].name})`, yLabel: "Difference", style: "scatter", error: "ci", groups: [{ name: "Difference", values: diffs }], test: null })
    }
    out.tables.push(descriptiveTable("Descriptive statistics", groups))
    if (test) out.tables.push(testsTable("Test", [test]))
    return out
  },

  two_way: (ds, roles, params, opts) => {
    const A = role(ds, roles, "factorA")
    const B = role(ds, roles, "factorB")
    const V = role(ds, roles, "value")
    need(A && B && V, "Pick two factor columns and a measurement.")
    const la = levelsOf(A!)
    const lb = levelsOf(B!)
    need(la.length <= 30 && lb.length <= 30, "Each factor can have at most 30 levels — pick category columns.")
    const cell = (a: string, b: string) => V!.values.flatMap((v, i) => (str(A!.values[i]) === a && str(B!.values[i]) === b && typeof v === "number" ? [v] : []))
    const series = lb.map((b) => ({
      name: b,
      values: la.map((a) => (cell(a, b).length ? mean(cell(a, b)) : null)),
      err: la.map((a) => errHalf(cell(a, b), opts.error)),
      points: la.map((a) => cell(a, b)),
    }))
    const rows = V!.values.flatMap((v, i) => (typeof v === "number" && str(A!.values[i]) !== null && str(B!.values[i]) !== null ? [i] : []))
    const anova = twoWayAnova(rows.map((i) => str(A!.values[i])!), rows.map((i) => str(B!.values[i])!), rows.map((i) => V!.values[i] as number))
    const out: Result = { headline: `${A!.name} (${la.length}) × ${B!.name} (${lb.length}) · ${V!.name}`, charts: [], tables: [] }
    if (params.chart === "split violin" && lb.length === 2) {
      const split: ChartSpec = { kind: "split", title: `${V!.name} by ${A!.name}, split by ${B!.name}`, yLabel: V!.name, categories: la, sides: [lb[0], lb[1]], values: [la.map((a) => cell(a, lb[0])), la.map((a) => cell(a, lb[1]))] }
      out.charts.push(split)
    } else {
      if (params.chart === "split violin") out.headline += ` · split violin needs exactly 2 levels in ${B!.name}`
      out.charts.push({ kind: "grouped", title: `${V!.name} by ${A!.name} and ${B!.name}`, yLabel: V!.name, categories: la, series, mode: "grouped", note: `Mean ± ${errLabel(opts.error)}` })
    }
    if (anova)
      out.tables.push({
        title: "Two-way ANOVA (type III)",
        columns: ["Source of variation", "SS", "DF", "MS", "F", "P value", "Summary"],
        rows: anova.map((r) => [r.source.replace("Factor A", A!.name).replace("Factor B", B!.name).replace("Interaction", `${A!.name} × ${B!.name}`), r.ss, r.df, r.ms, Number.isFinite(r.F) ? r.F : null, Number.isFinite(r.p) ? fmtP(r.p) : null, Number.isFinite(r.p) ? stars(r.p) : null]),
      })
    out.tables.push(descriptiveTable("Cell means", la.flatMap((a) => lb.map((b) => ({ name: `${a} · ${b}`, values: cell(a, b) })))))
    return out
  },

  summary_bars: (ds, roles, params) => {
    const L = role(ds, roles, "label")
    const Mn = role(ds, roles, "mean")
    const E = role(ds, roles, "error")
    const N = role(ds, roles, "n")
    need(L && Mn, "Pick a label column and a mean column.")
    const idx = Mn!.values.flatMap((v, i) => (typeof v === "number" ? [i] : []))
    const labels = idx.map((i) => str(L!.values[i]) ?? `Row ${i + 1}`)
    const means = idx.map((i) => Mn!.values[i] as number)
    const errs = idx.map((i) => (E ? toNumber(E.values[i]) : null))
    const ns = idx.map((i) => (N ? toNumber(N.values[i]) : null))
    const out: Result = { headline: `${idx.length} groups from summary data`, charts: [], tables: [] }
    out.charts.push({ kind: "grouped", title: Mn!.name, yLabel: Mn!.name, categories: labels, series: [{ name: Mn!.name, values: means, err: errs }], mode: "grouped", note: E ? `Mean ± ${params.errorType === "sem" ? "SEM" : "SD"}` : "Mean" })
    out.tables.push({ title: "Summary data", columns: ["Group", "Mean", params.errorType === "sem" ? "SEM" : "SD", "N"], rows: labels.map((l, i) => [l, means[i], errs[i], ns[i]]) })
    if (idx.length === 2 && errs.every((e) => e !== null) && ns.every((n) => n !== null && n > 1)) {
      const sd = errs.map((e, i) => (params.errorType === "sem" ? e! * Math.sqrt(ns[i]!) : e!))
      const va = sd[0] ** 2 / ns[0]!
      const vb = sd[1] ** 2 / ns[1]!
      const t = (means[0] - means[1]) / Math.sqrt(va + vb)
      const df = (va + vb) ** 2 / (va ** 2 / (ns[0]! - 1) + vb ** 2 / (ns[1]! - 1))
      const p = tTwoSidedP(t, df)
      out.tables.push(testsTable("Test from summary data", [{ name: "Unpaired t test (Welch)", statistic: `t = ${fmt(t)}, df = ${fmt(df)}`, p, summary: stars(p) }]))
    }
    return out
  },

  xy: (ds, roles, params, opts) => {
    const X = role(ds, roles, "x")
    const Ys = roleAll(ds, roles, "y")
    need(X && Ys.length, "Pick an X column and at least one Y column.")
    const xIsDate = X!.kind === "date"
    const xs = X!.values.map((v) => (v === null ? null : xIsDate ? Date.parse(String(v)) : toNumber(v)))
    const order = xs.map((_, i) => i).filter((i) => xs[i] !== null).sort((a, b) => xs[a]! - xs[b]!)
    const normalize = (c: Column): Column => {
      const mode = params.normalize
      if (!mode || mode === "none") return c
      const seq = order.map((i) => c.values[i]).filter((v): v is number => typeof v === "number")
      const f0 = mode === "ΔF/F0" ? mean(seq.slice(0, Math.max(1, Math.round(seq.length * 0.1)))) : mode === "% of max" ? Math.max(...seq) : seq[0]
      need(Number.isFinite(f0) && f0 !== 0, `Cannot normalize “${c.name}”: baseline is zero.`)
      return { ...c, values: c.values.map((v) => (typeof v !== "number" ? v : mode === "ΔF/F0" ? (v - f0) / f0 : mode === "% of max" ? (100 * v) / f0 : v / f0)) }
    }
    const sets = replicateSets(Ys).map((set) => ({ ...set, cols: set.cols.map(normalize) }))
    const series: XYSeries[] = sets.map((set) => ({
      name: set.name,
      mode: "line+points",
      points: xs.flatMap((x, i): XYPoint[] => {
        const vals = set.cols.map((c) => c.values[i]).filter((v): v is number => typeof v === "number")
        if (x === null || !vals.length) return []
        const m = mean(vals)
        const e = set.cols.length > 1 ? errHalf(vals, opts.error) : 0
        return [e ? { x, y: m, lo: m - e, hi: m + e } : { x, y: m }]
      }),
    }))
    const out: Result = { headline: `X = “${X!.name}” · ${sets.length} series${sets.some((s) => s.cols.length > 1) ? " (replicates averaged)" : ""}`, charts: [], tables: [] }
    const fitRows: TableSpec["rows"] = []
    if ((params.fit === "linear" || params.fit === "initial rate") && !xIsDate) {
      sets.forEach((set, k) => {
        let pts = xs.flatMap((x, i) => set.cols.flatMap((c) => (x !== null && typeof c.values[i] === "number" ? [[x, c.values[i] as number] as const] : [])))
        if (params.fit === "initial rate") {
          const xsSorted = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b)
          const cutoff = xsSorted[Math.max(2, Math.ceil(xsSorted.length * 0.25)) - 1]
          pts = pts.filter((p) => p[0] <= cutoff)
        }
        const f = linearFit(pts.map((p) => p[0]), pts.map((p) => p[1]))
        const r = pearson(pts.map((p) => p[0]), pts.map((p) => p[1]))
        if (!f) return
        series[k].mode = "points"
        const xr = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))]
        series.push({ name: `${set.name} fit`, mode: "line", dashed: true, hideInLegend: true, color: undefined, points: xr.map((x) => ({ x, y: f.intercept + f.slope * x })) })
        fitRows.push([set.name, f.slope, f.intercept, f.r2, r ? fmtP(r.p) : null, pts.length])
      })
      // keep fit lines the same color as their data
      series.forEach((s, i) => {
        if (s.name.endsWith(" fit")) s.color = PALETTE_FOR(series.findIndex((d) => d.name === s.name.slice(0, -4)))
        else s.color = PALETTE_FOR(i)
      })
    }
    const yName = params.normalize === "ΔF/F0" ? "ΔF/F0" : params.normalize === "% of max" ? "% of max" : params.normalize === "fold of first" ? "Fold of first point" : sets.length === 1 ? sets[0].name : "Value"
    out.charts.push({ kind: "xy", title: sets.length === 1 ? `${sets[0].name} vs ${X!.name}` : `Y vs ${X!.name}`, xLabel: X!.name, yLabel: yName, xIsDate, series, note: sets.some((s) => s.cols.length > 1) ? `Mean ± ${errLabel(opts.error)}` : undefined })
    if (fitRows.length) out.tables.push({ title: params.fit === "initial rate" ? "Initial rate (linear fit, first 25% of X)" : "Linear regression", columns: ["Series", params.fit === "initial rate" ? "Initial rate (slope)" : "Slope", "Y-intercept", "R²", "P (slope ≠ 0)", "N"], rows: fitRows })
    out.tables.push(descriptiveTable("Column statistics", sets.map((s) => ({ name: s.name, values: s.cols.flatMap(numbersOf) }))))
    return out
  },

  time_course: (ds, roles, _p, opts) => {
    const X = role(ds, roles, "x")
    const V = role(ds, roles, "value")
    const G = role(ds, roles, "group")
    need(X && V, "Pick a time column and a value column.")
    const xIsDate = X!.kind === "date"
    const xv = X!.values.map((v) => (v === null ? null : xIsDate ? Date.parse(String(v)) : toNumber(v)))
    const lv = G ? levelsOf(G) : ["All"]
    need(lv.length <= 12, "Time-course groups: at most 12.")
    const series: XYSeries[] = lv.map((level) => {
      const byX = new Map<number, number[]>()
      V!.values.forEach((v, i) => {
        if (typeof v !== "number" || xv[i] === null || (G && str(G.values[i]) !== level)) return
        byX.set(xv[i]!, [...(byX.get(xv[i]!) ?? []), v])
      })
      return {
        name: level,
        mode: "line+points",
        points: [...byX.entries()].map(([x, vals]) => {
          const m = mean(vals)
          const e = errHalf(vals, opts.error)
          return { x, y: m, lo: m - e, hi: m + e }
        }),
      }
    })
    const xsSorted = [...new Set(xv.filter((x): x is number => x !== null))].sort((a, b) => a - b)
    return {
      headline: `${V!.name} over ${X!.name}${G ? ` · ${lv.length} groups` : ""}`,
      charts: [{ kind: "xy", title: `${V!.name} over ${X!.name}`, xLabel: X!.name, yLabel: V!.name, xIsDate, series, note: `Mean ± ${errLabel(opts.error)}` }],
      tables: [
        {
          title: `Mean ${V!.name} per time point`,
          columns: [X!.name, ...lv],
          rows: xsSorted.map((x) => [xIsDate ? new Date(x).toISOString().slice(0, 10) : x, ...series.map((s) => s.points.find((p) => p.x === x)?.y ?? null)]),
        },
      ],
    }
  },

  dose_response: (ds, roles, _p, opts) => {
    const D = role(ds, roles, "dose")
    const Rs = roleAll(ds, roles, "response")
    const G = role(ds, roles, "group")
    need(D && Rs.length, "Pick a dose column and a response column.")
    const raw = D!.values.map(toNumber)
    const alreadyLog = numbersOf(D!).some((v) => v < 0)
    const toX = (d: number | null) => (d === null ? null : alreadyLog ? d : d > 0 ? Math.log10(d) : null)
    const sets: { name: string; rows: { x: number; vals: number[] }[] }[] = []
    if (G) {
      need(levelsOf(G).length <= 12, "Dose–response groups: at most 12.")
      for (const level of levelsOf(G)) {
        const rows = raw.flatMap((d, i) => (str(G.values[i]) === level && toX(d) !== null && typeof Rs[0].values[i] === "number" ? [{ x: toX(d)!, vals: [Rs[0].values[i] as number] }] : []))
        sets.push({ name: level, rows })
      }
    } else {
      for (const set of replicateSets(Rs)) {
        const rows = raw.flatMap((d, i) => {
          const vals = set.cols.map((c) => c.values[i]).filter((v): v is number => typeof v === "number")
          return toX(d) !== null && vals.length ? [{ x: toX(d)!, vals }] : []
        })
        sets.push({ name: set.name, rows })
      }
    }
    const dropped = raw.filter((d) => d !== null && !alreadyLog && d <= 0).length
    const series: XYSeries[] = []
    const fitRows: TableSpec["rows"] = []
    sets.forEach((set, k) => {
      const byX = new Map<number, number[]>()
      set.rows.forEach((r) => byX.set(r.x, [...(byX.get(r.x) ?? []), ...r.vals]))
      const c = PALETTE_FOR(k)
      series.push({
        name: set.name,
        mode: "points",
        color: c,
        points: [...byX.entries()].map(([x, vals]) => {
          const m = mean(vals)
          const e = vals.length > 1 ? errHalf(vals, opts.error) : 0
          return { x: alreadyLog ? x : 10 ** x, y: m, ...(e ? { lo: m - e, hi: m + e } : {}) }
        }),
      })
      const xs = set.rows.flatMap((r) => r.vals.map(() => r.x))
      const ys = set.rows.flatMap((r) => r.vals)
      const fit = fit4PL(xs, ys)
      if (!fit) return
      const x0 = Math.min(...xs)
      const x1 = Math.max(...xs)
      series.push({ name: `${set.name} fit`, mode: "line", color: c, hideInLegend: true, points: Array.from({ length: 80 }, (_, i) => x0 + ((x1 - x0) * i) / 79).map((x) => ({ x: alreadyLog ? x : 10 ** x, y: fourPL(fit, x) })) })
      fitRows.push([set.name, fit.bottom, fit.top, fit.logEC50, alreadyLog ? null : 10 ** fit.logEC50, fit.hill, fit.r2, fit.n])
    })
    const descending = fitRows.length > 0 && (fitRows[0][5] as number) < 0
    return {
      headline: `${sets.length} curve${sets.length > 1 ? "s" : ""} · 4-parameter logistic fit on log ${D!.name}${dropped ? ` · ${dropped} zero-dose rows not shown on the log axis` : ""}`,
      charts: [{ kind: "xy", title: `Dose–response: ${sets.map((x) => x.name).join(" vs ")}`, xLabel: alreadyLog ? D!.name : `${D!.name} (log scale)`, yLabel: G ? Rs[0].name : sets.length === 1 ? sets[0].name : "Response", logX: !alreadyLog, series, note: `Mean ± ${errLabel(opts.error)} · 4PL fit` }],
      tables: [{ title: "Four-parameter logistic fit", columns: ["Curve", "Bottom", "Top", "LogEC50", descending ? "IC50" : "EC50", "Hill slope", "R²", "N"], rows: fitRows }],
    }
  },

  standard_curve: (ds, roles, params) => {
    const C = role(ds, roles, "conc")
    const Ss = roleAll(ds, roles, "signal")
    const S = role(ds, roles, "sample")
    need(C && Ss.length, "Pick the known-concentration column and the signal column(s).")
    const sig = Array.from({ length: ds.rowCount }, (_, i) => {
      const v = Ss.map((c) => c.values[i]).filter((x): x is number => typeof x === "number")
      return v.length ? mean(v) : null
    })
    const std = sig.flatMap((y, i) => (y !== null && typeof C!.values[i] === "number" ? [{ x: C!.values[i] as number, y }] : []))
    const unk = sig.flatMap((y, i) => (y !== null && C!.values[i] === null ? [{ i, y, name: S ? (str(S.values[i]) ?? `Row ${i + 1}`) : `Row ${i + 1}` }] : []))
    need(std.length >= 3, "Need at least 3 standards with a known concentration.")
    const lin = linearFit(std.map((p) => p.x), std.map((p) => p.y))
    const pos = std.filter((p) => p.x > 0)
    const fl = pos.length >= 5 ? fit4PL(pos.map((p) => Math.log10(p.x)), pos.map((p) => p.y)) : null
    const model = params.fit === "linear" || !fl ? "linear" : params.fit === "4pl" ? "4pl" : lin && lin.r2 >= 0.98 ? "linear" : "4pl"
    const inv = (y: number) => {
      if (model === "linear") return lin ? (y - lin.intercept) / lin.slope : NaN
      const r = (fl!.top - fl!.bottom) / (y - fl!.bottom) - 1
      return r > 0 ? 10 ** (fl!.logEC50 - Math.log10(r) / fl!.hill) : NaN
    }
    const [xmin, xmax] = [Math.min(...std.map((p) => p.x)), Math.max(...std.map((p) => p.x))]
    const [ymin, ymax] = [Math.min(...std.map((p) => p.y)), Math.max(...std.map((p) => p.y))]
    const curveX = model === "linear" ? [xmin, xmax] : Array.from({ length: 60 }, (_, i) => Math.log10(Math.min(...pos.map((p) => p.x))) + ((Math.log10(xmax) - Math.log10(Math.min(...pos.map((p) => p.x)))) * i) / 59).map((l) => 10 ** l)
    const unkPts = unk.map((u) => ({ x: inv(u.y), y: u.y, label: unk.length <= 12 ? u.name : undefined })).filter((p) => Number.isFinite(p.x) && p.x > 0)
    const series: XYSeries[] = [
      { name: "Standards", mode: "points", points: std, color: PALETTE_FOR(0) },
      { name: model === "linear" ? "Linear fit" : "4PL fit", mode: "line", hideInLegend: true, color: PALETTE_FOR(0), points: curveX.map((x) => ({ x, y: model === "linear" ? lin!.intercept + lin!.slope * x : fourPL(fl!, Math.log10(x)) })) },
      { name: "Unknowns", mode: "points", points: unkPts, color: PALETTE_FOR(1), size: 4.5 },
    ]
    const eq = model === "linear" ? `Y = ${fmt(lin!.slope)}·X ${lin!.intercept < 0 ? "−" : "+"} ${fmt(Math.abs(lin!.intercept))}, R² = ${fmt(lin!.r2, 4)}` : `4PL: bottom ${fmt(fl!.bottom)}, top ${fmt(fl!.top)}, EC50 ${fmt(10 ** fl!.logEC50)}, Hill ${fmt(fl!.hill)}, R² = ${fmt(fl!.r2, 4)}`
    return {
      headline: `${std.length} standards · ${unk.length} unknowns · ${model === "linear" ? "linear" : "4PL"} fit`,
      charts: [{ kind: "xy", title: "Standard curve", xLabel: C!.name, yLabel: Ss.length === 1 ? Ss[0].name : "Signal (mean)", logX: model === "4pl", series, note: eq }],
      tables: [
        { title: "Interpolated unknowns", columns: ["Sample", "Signal", `Interpolated ${C!.name}`, "Flag"], rows: unk.map((u) => { const x = inv(u.y); return [u.name, u.y, Number.isFinite(x) ? x : null, !Number.isFinite(x) ? "Cannot interpolate" : u.y < ymin || u.y > ymax ? "Outside standard range" : ""] }) },
        { title: "Standards", columns: [C!.name, "Signal", "Back-calculated", "% recovery"], rows: std.map((p) => { const b = inv(p.y); return [p.x, p.y, Number.isFinite(b) ? b : null, p.x > 0 && Number.isFinite(b) ? (100 * b) / p.x : null] }) },
      ],
    }
  },

  kinetics: (ds, roles, _p, opts) => {
    const S = role(ds, roles, "substrate")
    const Vs = roleAll(ds, roles, "velocity")
    need(S && Vs.length, "Pick substrate and velocity columns.")
    const rows = S!.values.flatMap((s, i) => {
      const vals = Vs.map((c) => c.values[i]).filter((v): v is number => typeof v === "number")
      return typeof s === "number" && vals.length ? [{ s, vals }] : []
    })
    const fit = fitMichaelisMenten(rows.flatMap((r) => r.vals.map(() => r.s)), rows.flatMap((r) => r.vals))
    const smax = Math.max(...rows.map((r) => r.s))
    const series: XYSeries[] = [{ name: "Data", mode: "points", color: PALETTE_FOR(0), points: rows.map((r) => { const m = mean(r.vals); const e = r.vals.length > 1 ? errHalf(r.vals, opts.error) : 0; return { x: r.s, y: m, ...(e ? { lo: m - e, hi: m + e } : {}) } }) }]
    if (fit) series.push({ name: "Michaelis–Menten fit", mode: "line", color: PALETTE_FOR(0), hideInLegend: true, points: Array.from({ length: 60 }, (_, i) => (smax * i) / 59).map((x) => ({ x, y: (fit.vmax * x) / (fit.km + x) })) })
    return {
      headline: `${rows.length} substrate concentrations · Michaelis–Menten fit`,
      charts: [{ kind: "xy", title: "Enzyme kinetics", xLabel: S!.name, yLabel: Vs.length === 1 ? Vs[0].name : "Velocity", series, refLines: fit ? [{ axis: "y", value: fit.vmax, label: "Vmax" }, { axis: "x", value: fit.km, label: "Km" }] : [], note: fit ? `Vmax = ${fmt(fit.vmax)}, Km = ${fmt(fit.km)}, R² = ${fmt(fit.r2, 4)}` : "Fit failed" }],
      tables: fit ? [{ title: "Michaelis–Menten fit", columns: ["Vmax", "Km", "R²", "N"], rows: [[fit.vmax, fit.km, fit.r2, rows.reduce((s, r) => s + r.vals.length, 0)]] }] : [],
    }
  },

  survival: (ds, roles) => {
    const T = role(ds, roles, "time")
    const E = role(ds, roles, "event")
    const G = role(ds, roles, "group")
    need(T && E, "Pick a time column and an event column.")
    const isEvent = (v: unknown) => {
      if (typeof v === "number") return v === 1
      const s = String(v ?? "").trim().toLowerCase()
      return /^(1|yes|y|true|dead|died|death|deceased|event|relapse|relapsed|progressed|progression)$/.test(s)
    }
    const lv = G ? levelsOf(G) : ["All subjects"]
    need(lv.length <= 12, "Survival groups: at most 12.")
    const groups = lv.map((level) => {
      const idx = T!.values.flatMap((t, i) => (typeof t === "number" && E!.values[i] !== null && (!G || str(G.values[i]) === level) ? [i] : []))
      return { name: level, times: idx.map((i) => T!.values[i] as number), events: idx.map((i) => isEvent(E!.values[i])) }
    })
    const series: XYSeries[] = groups.map((g, k) => {
      const km = kaplanMeier(g.times, g.events)
      const last = Math.max(...g.times)
      const pts = km.steps.map((s) => ({ x: s.t, y: 100 * s.s }))
      if (pts[pts.length - 1].x < last) pts.push({ x: last, y: pts[pts.length - 1].y })
      return { name: g.name, mode: "step", color: PALETTE_FOR(k), points: pts, ticks: km.censorMarks.map((c) => ({ x: c.t, y: 100 * c.s })) }
    })
    const test = groups.length > 1 ? logRank(groups) : null
    return {
      headline: `${groups.reduce((s, g) => s + g.times.length, 0)} subjects · ${groups.length} group${groups.length > 1 ? "s" : ""} · ticks = censored`,
      charts: [{ kind: "xy", title: "Kaplan–Meier survival", xLabel: T!.name, yLabel: "Percent survival", yDomain: [0, 100], series, refLines: [{ axis: "y", value: 50 }], note: test ? `${test.name}: P ${test.p < 0.0001 ? "" : "= "}${fmtP(test.p)} (${test.summary})` : undefined }],
      tables: [
        { title: "Survival summary", columns: ["Group", "N", "Events", "Censored", "Median survival"], rows: groups.map((g) => { const km = kaplanMeier(g.times, g.events); const ev = g.events.filter(Boolean).length; return [g.name, g.times.length, ev, g.times.length - ev, km.median ?? "Undefined"] }) },
        ...(test ? [testsTable("Curve comparison", [test])] : []),
      ],
    }
  },

  contingency: (ds, roles) => {
    const R = role(ds, roles, "rows")
    const Cc = role(ds, roles, "cols")
    const Ns = roleAll(ds, roles, "counts")
    need(R && (Cc || Ns.length >= 2), "Pick a row column plus either an outcome column or two or more count columns.")
    let rowLv: string[]
    let colLv: string[]
    let table: number[][]
    if (Cc) {
      rowLv = levelsOf(R!)
      colLv = levelsOf(Cc)
      need(rowLv.length <= 30 && colLv.length <= 30, "Contingency tables need columns with at most 30 categories.")
      table = rowLv.map((r) => colLv.map((c) => R!.values.filter((v, i) => str(v) === r && str(Cc.values[i]) === c).length))
    } else {
      const idx = R!.values.flatMap((v, i) => (v !== null ? [i] : []))
      rowLv = idx.map((i) => str(R!.values[i])!)
      colLv = Ns.map((c) => c.name)
      table = idx.map((i) => Ns.map((c) => toNumber(c.values[i]) ?? 0))
    }
    const test = table.length === 2 && colLv.length === 2 ? fisherExact(table) : null
    const chi = chiSquareTest(table)
    const totals = table.map((r) => r.reduce((s, v) => s + v, 0))
    return {
      headline: `${rowLv.length} × ${colLv.length} contingency table · ${totals.reduce((s, v) => s + v, 0)} total`,
      charts: [
        { kind: "grouped", title: "Percent of each group", yLabel: "group", categories: rowLv, series: colLv.map((c, j) => ({ name: c, values: table.map((r) => r[j]) })), mode: "percent", note: test ? `${test.name}: P = ${fmtP(test.p)} (${test.summary})` : chi ? `${chi.name}: P = ${fmtP(chi.p)} (${chi.summary})` : undefined },
        { kind: "grouped", title: "Counts", yLabel: "Count", categories: rowLv, series: colLv.map((c, j) => ({ name: c, values: table.map((r) => r[j]) })), mode: "grouped" },
        { kind: "heatmap", title: "Count matrix (row %)", rows: rowLv, cols: colLv, values: table.map((r, i) => r.map((v) => (totals[i] ? (100 * v) / totals[i] : null))), scale: "sequential", domain: [0, 100], legendLabel: "row %", showValues: true },
      ],
      tables: [
        { title: "Counts (row %)", columns: ["", ...colLv, "Total"], rows: rowLv.map((r, i) => [r, ...table[i].map((v) => `${v} (${totals[i] ? ((100 * v) / totals[i]).toFixed(1) : "0"}%)`), totals[i]]) },
        testsTable("Tests", [test, chi]),
      ],
    }
  },

  parts: (ds, roles, params) => {
    const L = role(ds, roles, "label")
    const V = role(ds, roles, "value")
    need(L && V, "Pick a label column and an amount column.")
    need(levelsOf(L!).length <= 40, "Pie charts need at most 40 parts.")
    const slices = V!.values.flatMap((v, i) => (typeof v === "number" && v > 0 ? [{ label: str(L!.values[i]) ?? `Row ${i + 1}`, value: v }] : []))
    const total = slices.reduce((s, x) => s + x.value, 0)
    return {
      headline: `${slices.length} parts · total ${fmt(total)}`,
      charts: [{ kind: "pie", title: V!.name, slices, donut: params.shape !== "pie" }],
      tables: [{ title: "Fractions", columns: [L!.name, V!.name, "% of total"], rows: slices.map((s) => [s.label, s.value, (100 * s.value) / total]) }],
    }
  },

  histogram: (ds, roles, params) => {
    const V = role(ds, roles, "value")
    const G = role(ds, roles, "group")
    need(V, "Pick a numeric column.")
    const lv = G ? levelsOf(G) : [V!.name]
    need(lv.length <= 8, "Histogram groups: at most 8.")
    const groups = lv.map((level) => ({ name: level, values: V!.values.flatMap((v, i) => (typeof v === "number" && (!G || str(G.values[i]) === level) ? [v] : [])) }))
    const all = groups.flatMap((g) => g.values)
    need(all.length >= 3, "Need at least 3 values.")
    const s = summarize(all)
    if (params.bins === "log") {
      const pos = groups.map((g) => ({ ...g, values: g.values.filter((v) => v > 0).map(Math.log10) }))
      const lg = pos.flatMap((g) => g.values)
      need(lg.length >= 3, "Log bins need positive values.")
      const ls = summarize(lg)
      const nbins = Math.min(120, Math.max(10, Math.ceil(2 * Math.cbrt(lg.length) * 2)))
      const w = (ls.max - ls.min) / nbins || 0.1
      const series: XYSeries[] = pos.map((g, k) => {
        const counts = new Array(nbins).fill(0)
        g.values.forEach((v) => counts[Math.min(nbins - 1, Math.floor((v - ls.min) / w))]++)
        return { name: g.name, mode: groups.length > 1 ? "line" : "bars", color: PALETTE_FOR(k), points: counts.map((c, b) => ({ x: 10 ** (ls.min + w * (b + 0.5)), y: c, bin: [10 ** (ls.min + w * b), 10 ** (ls.min + w * (b + 1))] as [number, number] })) }
      })
      const dropped = all.length - lg.length
      const table = descriptiveTable("Descriptive statistics", groups)
      table.rows.push(["Geometric mean", ...pos.map((g) => (g.values.length ? 10 ** mean(g.values) : null))])
      return {
        headline: `${lg.length} values · ${nbins} log-spaced bins${dropped ? ` · ${dropped} values ≤ 0 not shown` : ""}`,
        charts: [{ kind: "xy", title: `Frequency distribution of ${V!.name}`, xLabel: `${V!.name} (log scale)`, yLabel: "Count", logX: true, series }],
        tables: [table],
      }
    }
    const iqr = s.q3 - s.q1
    const raw = iqr > 0 ? (2 * iqr) / Math.cbrt(all.length) : (s.max - s.min) / Math.ceil(Math.log2(all.length) + 1)
    const mag = 10 ** Math.floor(Math.log10(raw || 1))
    const width = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((w) => w >= raw) ?? raw
    const start = Math.floor(s.min / width) * width
    const nb = Math.max(1, Math.ceil((s.max - start) / width + 1e-9))
    const series: XYSeries[] = groups.map((g, k) => {
      const counts = new Array(nb).fill(0)
      g.values.forEach((v) => counts[Math.min(nb - 1, Math.floor((v - start) / width))]++)
      return { name: g.name, mode: "bars", barWidth: groups.length > 1 ? width / groups.length : width, color: PALETTE_FOR(k), points: counts.map((c, b) => ({ x: start + width * (b + 0.5) + (groups.length > 1 ? (k - (groups.length - 1) / 2) * (width / groups.length) : 0), y: c })) }
    })
    if (groups.length === 1 && s.sd > 0) series.push({ name: "Normal fit", mode: "line", dashed: true, color: "#1a1a1a", hideInLegend: true, points: Array.from({ length: 60 }, (_, i) => start + ((nb * width) * i) / 59).map((x) => ({ x, y: normalPdf(x, s.mean, s.sd) * all.length * width })) })
    const skew = all.reduce((a, v) => a + ((v - s.mean) / (s.sd || 1)) ** 3, 0) / all.length
    const table = descriptiveTable("Descriptive statistics", groups)
    table.rows.push(["Skewness", ...groups.map((g) => { const gs = summarize(g.values); return g.values.reduce((a, v) => a + ((v - gs.mean) / (gs.sd || 1)) ** 3, 0) / (g.values.length || 1) })])
    return {
      headline: `${all.length} values · bin width ${fmt(width)} · skewness ${fmt(skew)}`,
      charts: [{ kind: "xy", title: `Frequency distribution of ${V!.name}`, xLabel: V!.name, yLabel: "Number of values", series, note: groups.length === 1 ? "Dashed: normal curve with same mean and SD" : undefined }],
      tables: [table],
    }
  },

  correlation: (ds, roles) => {
    const Vs = roleAll(ds, roles, "values")
    need(Vs.length >= 2, "Pick at least two numeric columns.")
    const pairs = (a: Column, b: Column) => a.values.flatMap((v, i) => (typeof v === "number" && typeof b.values[i] === "number" ? [[v, b.values[i] as number] as const] : []))
    if (Vs.length === 2) {
      const [a, b] = Vs
      const pts = pairs(a, b)
      const pr = pearson(pts.map((p) => p[0]), pts.map((p) => p[1]))
      const sp = spearman(pts.map((p) => p[0]), pts.map((p) => p[1]))
      const f = linearFit(pts.map((p) => p[0]), pts.map((p) => p[1]))
      const xr = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))]
      return {
        headline: `${pts.length} XY pairs · Pearson r = ${pr ? fmt(pr.r) : "–"}`,
        charts: [{ kind: "xy", title: `${b.name} vs ${a.name}`, xLabel: a.name, yLabel: b.name, series: [{ name: "Data", mode: "points", points: pts.map(([x, y]) => ({ x, y })) }, ...(f ? [{ name: "Regression", mode: "line" as const, dashed: true, color: "#1a1a1a", hideInLegend: true, points: xr.map((x) => ({ x, y: f.intercept + f.slope * x })) }] : [])], note: pr ? `r = ${fmt(pr.r)}, R² = ${fmt(pr.r * pr.r)}, P ${pr.p < 0.0001 ? "" : "= "}${fmtP(pr.p)}` : undefined }],
        tables: [{ title: "Correlation", columns: ["Method", "r", "R²", "P value", "Summary", "N"], rows: [pr ? ["Pearson", pr.r, pr.r * pr.r, fmtP(pr.p), stars(pr.p), pr.n] : ["Pearson", null, null, null, null, pts.length], sp ? ["Spearman", sp.r, null, fmtP(sp.p), stars(sp.p), sp.n] : ["Spearman", null, null, null, null, pts.length]] }, ...(f ? [{ title: "Linear regression", columns: ["Slope", "Y-intercept", "R²"], rows: [[f.slope, f.intercept, f.r2]] }] : [])],
      }
    }
    const mat = Vs.map((a) => Vs.map((b) => (a === b ? 1 : (() => { const p = pairs(a, b); return pearson(p.map((q) => q[0]), p.map((q) => q[1]))?.r ?? null })())))
    const pRows: TableSpec["rows"] = []
    Vs.forEach((a, i) => Vs.forEach((b, j) => { if (j > i) { const p = pairs(a, b); const r = pearson(p.map((q) => q[0]), p.map((q) => q[1])); pRows.push([`${a.name} vs ${b.name}`, r?.r ?? null, r ? fmtP(r.p) : null, r ? stars(r.p) : null, p.length]) } }))
    return {
      headline: `${Vs.length} variables · Pearson correlation matrix`,
      charts: [{ kind: "heatmap", title: "Correlation matrix (Pearson r)", rows: names(Vs), cols: names(Vs), values: mat, scale: "diverging", domain: [-1, 1], legendLabel: "r", showValues: true }],
      tables: [{ title: "Pairwise correlations", columns: ["Pair", "Pearson r", "P value", "Summary", "N"], rows: pRows }],
    }
  },

  bland_altman: (ds, roles) => {
    const A = role(ds, roles, "a")
    const B = role(ds, roles, "b")
    need(A && B, "Pick two method columns.")
    const pts = A!.values.flatMap((v, i) => (typeof v === "number" && typeof B!.values[i] === "number" ? [{ x: (v + (B!.values[i] as number)) / 2, y: v - (B!.values[i] as number) }] : []))
    const s = summarize(pts.map((p) => p.y))
    const lo = s.mean - 1.96 * s.sd
    const hi = s.mean + 1.96 * s.sd
    return {
      headline: `${pts.length} paired measurements · bias ${fmt(s.mean)}`,
      charts: [{ kind: "xy", title: `Bland–Altman: ${A!.name} vs ${B!.name}`, xLabel: "Average of methods", yLabel: `Difference (${A!.name} − ${B!.name})`, series: [{ name: "Difference", mode: "points", points: pts }], refLines: [{ axis: "y", value: s.mean, label: `Bias ${fmt(s.mean)}` }, { axis: "y", value: lo, label: `−1.96 SD ${fmt(lo)}` }, { axis: "y", value: hi, label: `+1.96 SD ${fmt(hi)}` }, { axis: "y", value: 0 }] }],
      tables: [{ title: "Bias and limits of agreement", columns: ["Bias", "SD of bias", "Lower 95% LoA", "Upper 95% LoA", "95% CI of bias", "N"], rows: [[s.mean, s.sd, lo, hi, `${fmt(s.ciLow)} to ${fmt(s.ciHigh)}`, s.n]] }],
    }
  },

  qpcr: (ds, roles, params) => {
    const T = role(ds, roles, "target")
    const S = role(ds, roles, "sample")
    const CT = role(ds, roles, "ct")
    need(T && S && CT, "Pick target, sample and Ct columns.")
    const ref = params.reference
    const ctrl = params.control
    const rows = CT!.values.flatMap((v, i) => (typeof v === "number" && str(T!.values[i]) && str(S!.values[i]) ? [{ t: str(T!.values[i])!, s: str(S!.values[i])!, ct: v }] : []))
    const samples = levelsOf(S!)
    const targets = levelsOf(T!).filter((t) => t !== ref)
    need(samples.length <= 40 && targets.length <= 40, "Target and sample columns can have at most 40 levels each.")
    need(rows.some((r) => r.t === ref), `Reference gene “${ref}” has no Ct values.`)
    const refMean = new Map(samples.map((s) => [s, mean(rows.filter((r) => r.t === ref && r.s === s).map((r) => r.ct))]))
    const dct = (r: { s: string; ct: number }) => r.ct - (refMean.get(r.s) ?? NaN)
    const ctrlMean = new Map(targets.map((t) => [t, mean(rows.filter((r) => r.t === t && r.s === ctrl).map(dct))]))
    const fold = (t: string, s: string) => rows.filter((r) => r.t === t && r.s === s).map((r) => 2 ** -(dct(r) - (ctrlMean.get(t) ?? NaN))).filter(Number.isFinite)
    const table: TableSpec["rows"] = []
    targets.forEach((t) => samples.forEach((s) => {
      const sub = rows.filter((r) => r.t === t && r.s === s)
      if (!sub.length) return
      const d = mean(sub.map(dct))
      const fc = fold(t, s)
      table.push([t, s, sub.length, mean(sub.map((r) => r.ct)), d, d - (ctrlMean.get(t) ?? NaN), mean(fc), summarize(fc).sd])
    }))
    return {
      headline: `${targets.length} target gene${targets.length > 1 ? "s" : ""} · reference ${ref} · control ${ctrl} · fold change = 2^-ΔΔCt`,
      charts: [{ kind: "grouped", title: "Relative expression (2^-ΔΔCt)", yLabel: "Fold change vs control", categories: targets, series: samples.map((s) => ({ name: s, values: targets.map((t) => (fold(t, s).length ? mean(fold(t, s)) : null)), err: targets.map((t) => summarize(fold(t, s)).sd || null), points: targets.map((t) => fold(t, s)) })), mode: "grouped", refLine: 1, note: "Mean ± SD of replicates" }],
      tables: [{ title: "ΔΔCt calculation", columns: ["Target", "Sample", "N", "Mean Ct", "ΔCt", "ΔΔCt", "Fold change", "SD"], rows: table }],
    }
  },

  plate: (ds, roles) => {
    const RL = role(ds, roles, "rowLabel")
    const W = role(ds, roles, "well")
    const Vs = roleAll(ds, roles, "values")
    need(Vs.length && (RL || W), "Pick row letters + value columns, or a Well column + a value column.")
    let rows: string[]
    let colsL: string[]
    let values: (number | null)[][]
    if (W) {
      const cells = W.values.flatMap((w, i) => {
        const m = /^([A-Pa-p])(\d{1,2})$/.exec(String(w ?? "").trim())
        return m ? [{ r: m[1].toUpperCase(), c: Number(m[2]), v: toNumber(Vs[0].values[i]) }] : []
      })
      const nr = Math.max(...cells.map((c) => c.r.charCodeAt(0) - 64))
      const nc = Math.max(...cells.map((c) => c.c))
      rows = Array.from({ length: nr }, (_, i) => String.fromCharCode(65 + i))
      colsL = Array.from({ length: nc }, (_, i) => String(i + 1))
      values = rows.map((r) => colsL.map((c) => cells.find((x) => x.r === r && x.c === Number(c))?.v ?? null))
    } else {
      const idx = RL!.values.flatMap((v, i) => (v !== null ? [i] : []))
      rows = idx.map((i) => str(RL!.values[i])!)
      colsL = names(Vs)
      values = idx.map((i) => Vs.map((c) => toNumber(c.values[i])))
    }
    const flat = values.flat().filter((v): v is number => v !== null)
    const s = summarize(flat)
    return {
      headline: `${rows.length} × ${colsL.length} plate · ${flat.length} wells · mean ${fmt(s.mean)} · CV ${fmt((100 * s.sd) / s.mean)}%`,
      charts: [
        { kind: "heatmap", title: W ? `Plate map: ${Vs[0].name}` : "Plate map", rows, cols: colsL, values, scale: "sequential", showValues: true, legendLabel: W ? Vs[0].name : "Value" },
        { kind: "column", title: "Wells by plate column", yLabel: "Value", style: "scatter", error: "sd", groups: colsL.map((c, j) => ({ name: c, values: values.map((r) => r[j]).filter((v): v is number => v !== null) })), test: null },
      ],
      tables: [{ title: "Row and column means", columns: ["", ...colsL, "Row mean"], rows: [...rows.map((r, i) => [r, ...values[i], mean(values[i].filter((v): v is number => v !== null))]), ["Col mean", ...colsL.map((_, j) => mean(values.map((r) => r[j]).filter((v): v is number => v !== null))), s.mean]] }],
    }
  },

  volcano: (ds, roles, params) => {
    const FC = role(ds, roles, "fc")
    const P = role(ds, roles, "p")
    const L = role(ds, roles, "label")
    need(FC && P, "Pick log2 fold-change and P value columns.")
    const fcCut = Number(params.fcCutoff) || 1
    const pCut = Number(params.pCutoff) || 0.05
    const already = /-?log/i.test(P!.name)
    const pts = FC!.values.flatMap((f, i) => {
      const p = toNumber(P!.values[i])
      if (typeof f !== "number" || p === null) return []
      const nl = already ? p : p > 0 ? -Math.log10(p) : 300
      return [{ x: f, y: nl, p: already ? 10 ** -p : p, name: L ? (str(L.values[i]) ?? "") : `#${i + 1}` }]
    })
    const up = pts.filter((q) => q.p < pCut && q.x >= fcCut)
    const down = pts.filter((q) => q.p < pCut && q.x <= -fcCut)
    const ns = pts.filter((q) => !up.includes(q) && !down.includes(q))
    const top = [...up, ...down].sort((a, b) => a.p - b.p).slice(0, 10)
    const lab = (q: (typeof pts)[number]) => ({ x: q.x, y: q.y, label: top.includes(q) && L ? q.name : undefined })
    return {
      headline: `${pts.length} features · ${up.length} up · ${down.length} down (|log2FC| ≥ ${fcCut}, P < ${pCut})`,
      charts: [{ kind: "xy", title: "Volcano plot", xLabel: FC!.name, yLabel: "−log10(P)", series: [{ name: `Not significant (${ns.length})`, mode: "points", color: "#b8bcc4", size: 2.6, points: ns.map(lab) }, { name: `Down (${down.length})`, mode: "points", color: "#2f6fdb", size: 3.2, points: down.map(lab) }, { name: `Up (${up.length})`, mode: "points", color: "#e0533d", size: 3.2, points: up.map(lab) }], refLines: [{ axis: "x", value: fcCut }, { axis: "x", value: -fcCut }, { axis: "y", value: -Math.log10(pCut) }] }],
      tables: [{ title: "Top hits", columns: ["Feature", FC!.name, "P", "Direction"], rows: [...up, ...down].sort((a, b) => a.p - b.p).slice(0, 25).map((q) => [q.name, q.x, q.p < 0.0001 ? q.p.toExponential(2) : q.p, q.x > 0 ? "Up" : "Down"]) }],
    }
  },
}


export function runAnalysis(ds: Dataset, id: AnalysisId, roles: Roles, params: Params, opts: RunOptions): Result {
  try {
    return RUN[id](ds, roles, params, opts)
  } catch (e) {
    return { headline: `⚠ ${e instanceof Error ? e.message : String(e)}`, charts: [], tables: [] }
  }
}

/** Rows kept by a filter, as a new dataset (used by AI requests like “only Vehicle and Drug A”). */
export function filterDataset(ds: Dataset, column: string, values: string[]): Dataset {
  const c = byName(ds, column)
  if (!c) return ds
  const wanted = new Set(values.map((v) => v.trim().toLowerCase()))
  const keep = c.values.map((v) => v !== null && wanted.has(String(v).trim().toLowerCase()))
  return { ...ds, rowCount: keep.filter(Boolean).length, columns: ds.columns.map((col) => ({ ...col, values: col.values.filter((_, i) => keep[i]) })) }
}
