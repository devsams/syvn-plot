/** Descriptive statistics and simple tests, Prism-style. */
export type Summary = {
  n: number
  mean: number
  sd: number
  sem: number
  median: number
  q1: number
  q3: number
  min: number
  max: number
  ciLow: number
  ciHigh: number
}

export function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : NaN
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0
  const sd = Math.sqrt(variance)
  const sem = n ? sd / Math.sqrt(n) : NaN
  const t = n > 1 ? tCritical(0.975, n - 1) : 0
  return {
    n,
    mean,
    sd,
    sem,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0] ?? NaN,
    max: sorted[n - 1] ?? NaN,
    ciLow: mean - t * sem,
    ciHigh: mean + t * sem,
  }
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export type TestResult = { name: string; statistic: string; p: number; summary: string }

/** Welch's unpaired t test (two groups). */
export function welchT(a: number[], b: number[]): TestResult | null {
  const sa = summarize(a)
  const sb = summarize(b)
  if (sa.n < 2 || sb.n < 2) return null
  const va = sa.sd ** 2 / sa.n
  const vb = sb.sd ** 2 / sb.n
  if (va + vb === 0) return null
  const t = (sa.mean - sb.mean) / Math.sqrt(va + vb)
  const df = (va + vb) ** 2 / (va ** 2 / (sa.n - 1) + vb ** 2 / (sb.n - 1))
  const p = 2 * (1 - studentTCdf(Math.abs(t), df))
  return { name: "Unpaired t test (Welch)", statistic: `t = ${fmt(t)}, df = ${fmt(df)}`, p, summary: stars(p) }
}

/** Ordinary one-way ANOVA (three or more groups). */
export function oneWayAnova(groups: number[][]): TestResult | null {
  const valid = groups.filter((g) => g.length > 0)
  const k = valid.length
  const N = valid.reduce((s, g) => s + g.length, 0)
  if (k < 2 || N - k < 1) return null
  const grand = valid.flat().reduce((s, v) => s + v, 0) / N
  let ssb = 0
  let ssw = 0
  for (const g of valid) {
    const m = g.reduce((s, v) => s + v, 0) / g.length
    ssb += g.length * (m - grand) ** 2
    ssw += g.reduce((s, v) => s + (v - m) ** 2, 0)
  }
  const df1 = k - 1
  const df2 = N - k
  if (ssw === 0) return null
  const F = ssb / df1 / (ssw / df2)
  const p = 1 - incompleteBeta(df1 * F / (df1 * F + df2), df1 / 2, df2 / 2)
  return { name: "One-way ANOVA", statistic: `F (${df1}, ${df2}) = ${fmt(F)}`, p, summary: stars(p) }
}

/** Least-squares line with R². */
export function linearFit(xs: number[], ys: number[]) {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy) }
}

export function stars(p: number) {
  if (p < 0.0001) return "****"
  if (p < 0.001) return "***"
  if (p < 0.01) return "**"
  if (p < 0.05) return "*"
  return "ns"
}

export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "–"
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-3)) return value.toExponential(2)
  return Number(value.toPrecision(digits + 1)).toString()
}

export function fmtP(p: number) {
  return p < 0.0001 ? "< 0.0001" : p.toFixed(4)
}

// --- distributions --------------------------------------------------------

function studentTCdf(t: number, df: number) {
  const x = df / (df + t * t)
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

function tCritical(prob: number, df: number) {
  let lo = 0
  let hi = 1000
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (studentTCdf(mid, df) < prob) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function logGamma(z: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.9999999999998099
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (front * betaCf(x, a, b)) / a
  return 1 - (front * betaCf(1 - x, b, a)) / b
}

function betaCf(x: number, a: number, b: number) {
  const tiny = 1e-30
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 3e-12) break
  }
  return h
}

// --- more tests -----------------------------------------------------------

export function mean(v: number[]) {
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN
}

export function tTwoSidedP(t: number, df: number) {
  return 2 * (1 - studentTCdf(Math.abs(t), df))
}

export function fCdfUpper(F: number, df1: number, df2: number) {
  if (!(F > 0)) return 1
  return 1 - incompleteBeta((df1 * F) / (df1 * F + df2), df1 / 2, df2 / 2)
}

export function chiSquareUpper(x: number, df: number) {
  if (!(x > 0)) return 1
  return 1 - lowerGamma(df / 2, x / 2)
}

/** Paired t test on row-matched values. */
export function pairedT(a: number[], b: number[]): TestResult | null {
  const d = a.map((v, i) => b[i] - v)
  const s = summarize(d)
  if (s.n < 2 || s.sd === 0) return null
  const t = s.mean / s.sem
  const p = tTwoSidedP(t, s.n - 1)
  return { name: "Paired t test", statistic: `t = ${fmt(t)}, df = ${s.n - 1}`, p, summary: stars(p) }
}

/** One-way repeated-measures ANOVA (rows = subjects, complete cases). */
export function rmAnova(columns: number[][]): TestResult | null {
  const k = columns.length
  const n = columns[0]?.length ?? 0
  if (k < 2 || n < 2) return null
  const grand = mean(columns.flat())
  const ssTreat = columns.reduce((s, c) => s + n * (mean(c) - grand) ** 2, 0)
  let ssSubj = 0
  for (let i = 0; i < n; i++) ssSubj += k * (mean(columns.map((c) => c[i])) - grand) ** 2
  const ssTotal = columns.flat().reduce((s, v) => s + (v - grand) ** 2, 0)
  const ssErr = ssTotal - ssTreat - ssSubj
  const df1 = k - 1
  const df2 = (k - 1) * (n - 1)
  if (ssErr <= 0) return null
  const F = ssTreat / df1 / (ssErr / df2)
  const p = fCdfUpper(F, df1, df2)
  return { name: "Repeated-measures one-way ANOVA", statistic: `F (${df1}, ${df2}) = ${fmt(F)}`, p, summary: stars(p) }
}

export type Comparison = { a: number; b: number; diff: number; p: number; summary: string }

/** All pairwise comparisons using the pooled ANOVA SD, Holm–Šídák adjusted (Prism's default after ANOVA). */
export function holmSidak(groups: number[][]): Comparison[] {
  const valid = groups.map((g) => g.length > 0)
  const N = groups.reduce((s, g) => s + g.length, 0)
  const k = valid.filter(Boolean).length
  const df = N - k
  if (k < 3 || df < 1) return []
  const ssw = groups.reduce((s, g) => {
    const m = mean(g)
    return s + g.reduce((a, v) => a + (v - m) ** 2, 0)
  }, 0)
  const mse = ssw / df
  const raw: Comparison[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      if (!valid[i] || !valid[j]) continue
      const diff = mean(groups[j]) - mean(groups[i])
      const se = Math.sqrt(mse * (1 / groups[i].length + 1 / groups[j].length))
      raw.push({ a: i, b: j, diff, p: se > 0 ? tTwoSidedP(diff / se, df) : 1, summary: "" })
    }
  const m = raw.length
  const order = [...raw].sort((x, y) => x.p - y.p)
  let running = 0
  for (let r = 0; r < order.length; r++) {
    const adj = Math.min(1, 1 - (1 - order[r].p) ** (m - r))
    running = Math.max(running, adj)
    order[r].p = running
    order[r].summary = stars(running)
  }
  return raw
}

export function pearson(xs: number[], ys: number[]) {
  const n = xs.length
  if (n < 3) return null
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return null
  const r = sxy / Math.sqrt(sxx * syy)
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r))
  return { r, p: tTwoSidedP(t, n - 2), n }
}

function ranks(v: number[]) {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(v.length)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1
    i = j + 1
  }
  return out
}

export function spearman(xs: number[], ys: number[]) {
  return pearson(ranks(xs), ranks(ys))
}

/** Chi-square test of independence on a contingency table (rows × cols). */
export function chiSquareTest(table: number[][]): TestResult | null {
  const rowsT = table.map((r) => r.reduce((s, v) => s + v, 0))
  const colsT = table[0]?.map((_, j) => table.reduce((s, r) => s + r[j], 0)) ?? []
  const N = rowsT.reduce((s, v) => s + v, 0)
  const r = rowsT.filter((v) => v > 0).length
  const c = colsT.filter((v) => v > 0).length
  if (N === 0 || r < 2 || c < 2) return null
  let chi = 0
  table.forEach((row, i) =>
    row.forEach((o, j) => {
      const e = (rowsT[i] * colsT[j]) / N
      if (e > 0) chi += (o - e) ** 2 / e
    }),
  )
  const df = (r - 1) * (c - 1)
  const p = chiSquareUpper(chi, df)
  return { name: "Chi-square test", statistic: `χ² = ${fmt(chi)}, df = ${df}`, p, summary: stars(p) }
}

const logFact = (n: number) => logGamma(n + 1)

/** Two-sided Fisher's exact test for a 2×2 table. */
export function fisherExact(t: number[][]): TestResult | null {
  const [[a, b], [c, d]] = t
  const r1 = a + b
  const r2 = c + d
  const c1 = a + c
  const n = r1 + r2
  if (n === 0) return null
  const prob = (x: number) => Math.exp(logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1) - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(r2 - c1 + x))
  const pObs = prob(a)
  let p = 0
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const px = prob(x)
    if (px <= pObs * (1 + 1e-7)) p += px
  }
  p = Math.min(1, p)
  return { name: "Fisher's exact test", statistic: `odds ratio = ${b * c === 0 ? "∞" : fmt((a * d) / (b * c))}`, p, summary: stars(p) }
}

// --- survival -------------------------------------------------------------

export type KMStep = { t: number; s: number; atRisk: number; events: number; censored: number }

export function kaplanMeier(times: number[], events: boolean[]) {
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b])
  const steps: KMStep[] = [{ t: 0, s: 1, atRisk: times.length, events: 0, censored: 0 }]
  const censorMarks: { t: number; s: number }[] = []
  let atRisk = times.length
  let s = 1
  for (let i = 0; i < order.length; ) {
    const t = times[order[i]]
    let d = 0
    let c = 0
    while (i < order.length && times[order[i]] === t) {
      if (events[order[i]]) d++
      else c++
      i++
    }
    if (d > 0) {
      s *= 1 - d / atRisk
      steps.push({ t, s, atRisk, events: d, censored: c })
    }
    if (c > 0) censorMarks.push({ t, s })
    atRisk -= d + c
  }
  const median = steps.find((st) => st.s <= 0.5)?.t ?? null
  return { steps, censorMarks, median }
}

/** Log-rank (Mantel–Cox) test across k groups. */
export function logRank(groups: { times: number[]; events: boolean[] }[]): TestResult | null {
  const k = groups.length
  if (k < 2) return null
  const all = groups.flatMap((g, gi) => g.times.map((t, i) => ({ t, e: g.events[i], g: gi })))
  const eventTimes = [...new Set(all.filter((x) => x.e).map((x) => x.t))].sort((a, b) => a - b)
  const O = new Array(k).fill(0)
  const E = new Array(k).fill(0)
  const V = Array.from({ length: k }, () => new Array(k).fill(0))
  for (const t of eventTimes) {
    const nG = groups.map((g) => g.times.filter((x) => x >= t).length)
    const dG = groups.map((g) => g.times.filter((x, i) => x === t && g.events[i]).length)
    const n = nG.reduce((s, v) => s + v, 0)
    const d = dG.reduce((s, v) => s + v, 0)
    if (n < 2) continue
    for (let i = 0; i < k; i++) {
      O[i] += dG[i]
      E[i] += (nG[i] * d) / n
      for (let j = 0; j < k; j++) V[i][j] += ((d * (n - d)) / (n - 1)) * (nG[i] / n) * ((i === j ? 1 : 0) - nG[j] / n)
    }
  }
  const m = k - 1
  const diff = O.slice(0, m).map((o, i) => o - E[i])
  const inv = invert(V.slice(0, m).map((r) => r.slice(0, m)))
  if (!inv) return null
  let chi = 0
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) chi += diff[i] * inv[i][j] * diff[j]
  const p = chiSquareUpper(chi, m)
  return { name: "Log-rank (Mantel–Cox) test", statistic: `χ² = ${fmt(chi)}, df = ${m}`, p, summary: stars(p) }
}

// --- linear algebra, two-way ANOVA ----------------------------------------

function invert(A: number[][]): number[][] | null {
  const n = A.length
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    const piv = M[c][c]
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c]
      if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((r) => r.slice(n))
}

function rss(X: number[][], y: number[]) {
  const p = X[0].length
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-10 : 0)))
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0))
  const inv = invert(XtX)
  if (!inv) return NaN
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0))
  return y.reduce((s, v, k) => s + (v - X[k].reduce((a, x, j) => a + x * beta[j], 0)) ** 2, 0)
}

export type AnovaRow = { source: string; ss: number; df: number; ms: number; F: number; p: number }

/** Two-way ANOVA with interaction, type III sums of squares (effect coding). */
export function twoWayAnova(a: string[], b: string[], y: number[]): AnovaRow[] | null {
  const la = [...new Set(a)]
  const lb = [...new Set(b)]
  if (la.length < 2 || lb.length < 2 || y.length <= la.length * lb.length) return null
  const code = (levels: string[], v: string) => levels.slice(0, -1).map((l) => (v === l ? 1 : v === levels[levels.length - 1] ? -1 : 0))
  const rows = y.map((_, i) => {
    const A = code(la, a[i])
    const B = code(lb, b[i])
    const AB = A.flatMap((x) => B.map((z) => x * z))
    return { A, B, AB }
  })
  const build = (parts: ("A" | "B" | "AB")[]) => rows.map((r) => [1, ...parts.flatMap((p) => r[p])])
  const full = rss(build(["A", "B", "AB"]), y)
  const dfErr = y.length - la.length * lb.length
  const mse = full / dfErr
  const out: AnovaRow[] = []
  const terms: [string, ("A" | "B" | "AB")[], number][] = [
    ["Interaction", ["A", "B"], (la.length - 1) * (lb.length - 1)],
    ["Factor A", ["B", "AB"], la.length - 1],
    ["Factor B", ["A", "AB"], lb.length - 1],
  ]
  for (const [source, keep, df] of terms) {
    const ss = rss(build(keep), y) - full
    const F = ss / df / mse
    out.push({ source, ss, df, ms: ss / df, F, p: fCdfUpper(F, df, dfErr) })
  }
  out.push({ source: "Residual", ss: full, df: dfErr, ms: mse, F: NaN, p: NaN })
  return out
}

// --- curve fitting --------------------------------------------------------

export function nelderMead(f: (p: number[]) => number, start: number[], steps?: number[], iterations = 2000) {
  const n = start.length
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + (steps?.[i] ?? (Math.abs(v) * 0.1 || 0.1)) : v)))]
  let values = simplex.map(f)
  for (let it = 0; it < iterations; it++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
    simplex = order.map((i) => simplex[i])
    values = order.map((i) => values[i])
    if (Math.abs(values[n] - values[0]) < 1e-12 * (Math.abs(values[0]) + 1e-12)) break
    const centroid = start.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n)
    const at = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c))
    const xr = at(-1)
    const fr = f(xr)
    if (fr < values[0]) {
      const xe = at(-2)
      const fe = f(xe)
      ;[simplex[n], values[n]] = fe < fr ? [xe, fe] : [xr, fr]
    } else if (fr < values[n - 1]) {
      ;[simplex[n], values[n]] = [xr, fr]
    } else {
      const xc = at(fr < values[n] ? -0.5 : 0.5)
      const fc = f(xc)
      if (fc < Math.min(fr, values[n])) {
        ;[simplex[n], values[n]] = [xc, fc]
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))
          values[i] = f(simplex[i])
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values))
  return { params: simplex[best], sse: values[best] }
}

function rSquared(ys: number[], sse: number) {
  const m = mean(ys)
  const sst = ys.reduce((s, v) => s + (v - m) ** 2, 0)
  return sst > 0 ? 1 - sse / sst : NaN
}

export type FourPL = { bottom: number; top: number; logEC50: number; hill: number; r2: number; n: number }

export const fourPL = (p: { bottom: number; top: number; logEC50: number; hill: number }, x: number) => p.bottom + (p.top - p.bottom) / (1 + 10 ** ((p.logEC50 - x) * p.hill))

/** Four-parameter logistic fit of y against x = log10(dose). */
export function fit4PL(xs: number[], ys: number[], init?: { mid: number; hill: number }): FourPL | null {
  if (xs.length < 5) return null
  if (xs.length > 400) {
    const step = xs.length / 400
    const keep = Array.from({ length: 400 }, (_, i) => Math.floor(i * step))
    const f = fit4PL(keep.map((i) => xs[i]), keep.map((i) => ys[i]), init)
    return f ? { ...f, n: xs.length } : null
  }
  const lin = linearFit(xs, ys)
  const sorted = [...xs].sort((a, b) => a - b)
  const xspan = (sorted[sorted.length - 1] - sorted[0]) || 1
  const start = [Math.min(...ys), Math.max(...ys), init?.mid ?? sorted[Math.floor(sorted.length / 2)], init?.hill ?? (lin && lin.slope < 0 ? -1 : 1)]
  const sse = (p: number[]) => xs.reduce((s, x, i) => s + (ys[i] - fourPL({ bottom: p[0], top: p[1], logEC50: p[2], hill: p[3] }, x)) ** 2, 0)
  const span = Math.max(...ys) - Math.min(...ys) || 1
  const { params, sse: e } = nelderMead(sse, start, [span * 0.1, span * 0.1, Math.min(0.5, xspan * 0.05), Math.abs(start[3]) * 0.5 || 0.5], 4000)
  const [bottom, top, logEC50, hill] = params
  return { bottom, top, logEC50, hill, r2: rSquared(ys, e), n: xs.length }
}

/** Michaelis–Menten fit v = Vmax·S/(Km + S). */
export function fitMichaelisMenten(s: number[], v: number[]): { vmax: number; km: number; r2: number } | null {
  if (s.length < 4) return null
  if (s.length > 400) {
    const step = s.length / 400
    const keep = Array.from({ length: 400 }, (_, i) => Math.floor(i * step))
    return fitMichaelisMenten(keep.map((i) => s[i]), keep.map((i) => v[i]))
  }
  const sorted = [...s].sort((a, b) => a - b)
  const f = (p: number[]) => s.reduce((acc, x, i) => acc + (v[i] - (p[0] * x) / (Math.abs(p[1]) + x)) ** 2, 0)
  const { params, sse } = nelderMead(f, [Math.max(...v), sorted[Math.floor(sorted.length / 2)] || 1])
  return { vmax: params[0], km: Math.abs(params[1]), r2: rSquared(v, sse) }
}

export const normalPdf = (x: number, m: number, sd: number) => Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))

function lowerGamma(a: number, x: number) {
  if (x < a + 1) {
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
  }
  let b = x + 1 - a
  let c = 1e300
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-14) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

// --- matrices: eigen, clustering -----------------------------------------

/** Symmetric eigen-decomposition (Jacobi). Returns eigenvalues (desc) and column eigenvectors. */
export function symmetricEigen(A: number[][]) {
  const n = A.length
  const a = A.map((r) => [...r])
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
  }
  const order = a.map((_, i) => i).sort((i, j) => a[j][j] - a[i][i])
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => v.map((row) => row[i])) }
}

/** PCA on rows (observations) × columns (variables), standardized. Returns scores for the first k PCs. */
export function pca(X: number[][], k = 3, standardize = true) {
  const n = X.length
  const p = X[0]?.length ?? 0
  const means = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])))
  const sds = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / Math.max(1, n - 1)) || 1)
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / (standardize ? sds[j] : 1)))
  let scores: number[][]
  let eig: number[]
  let loadings: number[][] | null = null
  if (p <= n) {
    const C = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) / Math.max(1, n - 1)))
    const e = symmetricEigen(C)
    eig = e.values
    loadings = e.vectors.slice(0, k)
    scores = Z.map((r) => loadings!.map((vec) => r.reduce((s, x, j) => s + x * vec[j], 0)))
  } else {
    const G = Z.map((a) => Z.map((b) => a.reduce((s, x, j) => s + x * b[j], 0) / Math.max(1, n - 1)))
    const e = symmetricEigen(G)
    eig = e.values
    scores = Z.map((_, i) => e.vectors.slice(0, k).map((vec, c) => vec[i] * Math.sqrt(Math.max(0, e.values[c]) * Math.max(1, n - 1))))
  }
  const total = eig.reduce((s, v) => s + Math.max(0, v), 0) || 1
  return { scores, explained: eig.map((v) => Math.max(0, v) / total), loadings }
}

/** Leaf order from average-linkage hierarchical clustering on (1 − Pearson r) distance. */
export function clusterOrder(rows: number[][]): number[] {
  const n = rows.length
  if (n < 3) return rows.map((_, i) => i)
  const dist = (a: number[], b: number[]) => {
    const r = pearson(a, b)?.r
    return r === undefined || !Number.isFinite(r) ? 1 : 1 - r
  }
  const D = rows.map((a, i) => rows.map((b, j) => (i < j ? dist(a, b) : 0)))
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) D[i][j] = D[j][i]
  let clusters = rows.map((_, i) => ({ members: [i], order: [i] }))
  const cd = (x: { members: number[] }, y: { members: number[] }) => {
    let s = 0
    for (const a of x.members) for (const b of y.members) s += D[a][b]
    return s / (x.members.length * y.members.length)
  }
  while (clusters.length > 1) {
    let best: [number, number] = [0, 1]
    let bestD = Infinity
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = cd(clusters[i], clusters[j])
        if (d < bestD) {
          bestD = d
          best = [i, j]
        }
      }
    const [i, j] = best
    const merged = { members: [...clusters[i].members, ...clusters[j].members], order: [...clusters[i].order, ...clusters[j].order] }
    clusters = clusters.filter((_, k) => k !== i && k !== j)
    clusters.push(merged)
  }
  return clusters[0].order
}

export function zscoreRow(v: (number | null)[]) {
  const xs = v.filter((x): x is number => x !== null)
  const m = mean(xs)
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) || 1
  return v.map((x) => (x === null ? null : (x - m) / sd))
}

/** Area under a curve by the linear trapezoidal rule (points sorted by x). */
export function trapezoid(pts: { x: number; y: number }[]) {
  let a = 0
  for (let i = 1; i < pts.length; i++) a += ((pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y)) / 2
  return a
}
