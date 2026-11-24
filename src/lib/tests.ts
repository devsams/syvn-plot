/**
 * Additional hypothesis tests (no AI): Student's t, Welch ANOVA, non-parametric
 * tests (Mann–Whitney, Wilcoxon signed-rank, Kruskal–Wallis, Friedman),
 * multiple-comparison procedures (Tukey, Games–Howell, Bonferroni, Dunnett,
 * Dunn) and assumption checks (Shapiro–Wilk normality, Grubbs outlier).
 */
import { chiSquareUpper, fCdfUpper, fmt, logGamma, mean, stars, summarize, tTwoSidedP, type Comparison, type TestResult } from "./stats"

// --- normal distribution ---------------------------------------------------------

/** Standard normal CDF (Cody-style erfc approximation, |error| < 1e-7). */
export function normCdf(x: number) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.5 * z)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? 1 - r / 2 : r / 2
}

const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

/** Inverse standard normal CDF (Acklam's algorithm, relative error < 1.2e-9). */
export function normInv(p: number) {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// --- helpers ---------------------------------------------------------------------

function rankAll(values: number[]) {
  const idx = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0])
  const ranks = new Array<number>(values.length)
  const ties: number[] = []
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = (i + j) / 2 + 1
    if (j > i) ties.push(j - i + 1)
    i = j + 1
  }
  return { ranks, tieSum: ties.reduce((s, t) => s + t * t * t - t, 0), hasTies: ties.length > 0 }
}

const result = (name: string, statistic: string, p: number): TestResult => ({ name, statistic, p: Math.min(1, Math.max(0, p)), summary: stars(Math.min(1, Math.max(0, p))) })

/** Simpson's rule on [a, b] with n (even) intervals. */
function simpson(f: (x: number) => number, a: number, b: number, n: number) {
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

/** Density of s = sqrt(chi²_df / df), used to integrate over the variance estimate. */
function sDensity(df: number) {
  const logC = (df / 2) * Math.log(df) - logGamma(df / 2) - (df / 2 - 1) * Math.LN2
  return (s: number) => (s <= 0 ? 0 : Math.exp(logC + (df - 1) * Math.log(s) - (df * s * s) / 2))
}

function overS(df: number, inner: (s: number) => number) {
  if (!Number.isFinite(df) || df > 2000) return inner(1)
  const g = sDensity(df)
  const hi = 1 + 12 / Math.sqrt(df)
  return Math.min(1, simpson((s) => g(s) * inner(s), 0, hi, 240))
}

// --- two groups ------------------------------------------------------------------

export function studentT(a: number[], b: number[]): TestResult | null {
  const sa = summarize(a)
  const sb = summarize(b)
  if (sa.n < 2 || sb.n < 2) return null
  const df = sa.n + sb.n - 2
  const sp2 = ((sa.n - 1) * sa.sd ** 2 + (sb.n - 1) * sb.sd ** 2) / df
  if (sp2 === 0) return null
  const t = (sa.mean - sb.mean) / Math.sqrt(sp2 * (1 / sa.n + 1 / sb.n))
  return result("Unpaired t test (Student, equal SDs)", `t = ${fmt(t)}, df = ${df}`, tTwoSidedP(t, df))
}

/** Exact null distribution of U (no ties) by counting; small samples only. */
function mannWhitneyExactP(u: number, m: number, n: number) {
  // f[i][j][k] = ways to get U = k with i and j observations — rolled to 2D over j.
  const max = m * n
  let prev: number[][] = Array.from({ length: n + 1 }, () => new Array(max + 1).fill(0))
  for (let j = 0; j <= n; j++) prev[j][0] = 1
  for (let i = 1; i <= m; i++) {
    const cur: number[][] = Array.from({ length: n + 1 }, () => new Array(max + 1).fill(0))
    cur[0][0] = 1
    for (let j = 1; j <= n; j++) for (let k = 0; k <= i * j; k++) cur[j][k] = (k >= j ? prev[j][k - j] : 0) + cur[j - 1][k]
    prev = cur
  }
  const counts = prev[n]
  const total = counts.reduce((s, x) => s + x, 0)
  const lo = Math.min(u, max - u)
  let tail = 0
  for (let k = 0; k <= lo; k++) tail += counts[k]
  return Math.min(1, (2 * tail) / total)
}

export function mannWhitney(a: number[], b: number[]): TestResult | null {
  const m = a.length
  const n = b.length
  if (m < 1 || n < 1 || m + n < 3) return null
  const { ranks, tieSum, hasTies } = rankAll([...a, ...b])
  const r1 = ranks.slice(0, m).reduce((s, r) => s + r, 0)
  const u1 = r1 - (m * (m + 1)) / 2
  const u = Math.min(u1, m * n - u1)
  let p: number
  let how: string
  if (!hasTies && m <= 25 && n <= 25) {
    p = mannWhitneyExactP(u, m, n)
    how = "exact"
  } else {
    const N = m + n
    const sigma = Math.sqrt(((m * n) / 12) * (N + 1 - tieSum / (N * (N - 1))))
    const z = (Math.abs(u1 - (m * n) / 2) - 0.5) / (sigma || 1)
    p = 2 * (1 - normCdf(z))
    how = "normal approx."
  }
  return result("Mann–Whitney test", `U = ${fmt(u)} (${how})`, p)
}

// --- paired ------------------------------------------------------------------------

export function wilcoxonSignedRank(a: number[], b: number[]): TestResult | null {
  const d = a.map((x, i) => b[i] - x).filter((x) => x !== 0)
  const n = d.length
  if (n < 2) return null
  const { ranks, tieSum, hasTies } = rankAll(d.map(Math.abs))
  const wPlus = d.reduce((s, x, i) => s + (x > 0 ? ranks[i] : 0), 0)
  const max = (n * (n + 1)) / 2
  let p: number
  let how: string
  if (!hasTies && n <= 30) {
    const counts = new Array(max + 1).fill(0)
    counts[0] = 1
    for (let r = 1; r <= n; r++) for (let k = max; k >= r; k--) counts[k] += counts[k - r]
    const total = 2 ** n
    const lo = Math.min(wPlus, max - wPlus)
    let tail = 0
    for (let k = 0; k <= lo; k++) tail += counts[k]
    p = Math.min(1, (2 * tail) / total)
    how = "exact"
  } else {
    const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieSum / 48)
    const z = (Math.abs(wPlus - max / 2) - 0.5) / (sigma || 1)
    p = 2 * (1 - normCdf(z))
    how = "normal approx."
  }
  return result("Wilcoxon matched-pairs signed-rank test", `W+ = ${fmt(wPlus)}, n = ${n} (${how})`, p)
}

/** Friedman test: rows are subjects (complete cases), columns are conditions. */
export function friedman(columns: number[][]): TestResult | null {
  const k = columns.length
  const n = columns[0]?.length ?? 0
  if (k < 2 || n < 2) return null
  const R = new Array(k).fill(0)
  let tieSum = 0
  for (let i = 0; i < n; i++) {
    const r = rankAll(columns.map((c) => c[i]))
    r.ranks.forEach((x, j) => (R[j] += x))
    tieSum += r.tieSum
  }
  const ss = R.reduce((s, x) => s + (x - (n * (k + 1)) / 2) ** 2, 0)
  const q = (12 * ss) / (n * k * (k + 1) - tieSum / (k - 1))
  return result("Friedman test", `Q = ${fmt(q)}, df = ${k - 1}`, chiSquareUpper(q, k - 1))
}

// --- three or more groups -----------------------------------------------------------

export function welchAnova(groups: number[][]): TestResult | null {
  const g = groups.filter((x) => x.length >= 2).map((x) => summarize(x))
  const k = g.length
  if (k < 2 || g.some((s) => s.sd === 0)) return null
  const w = g.map((s) => s.n / s.sd ** 2)
  const W = w.reduce((s, x) => s + x, 0)
  const mw = g.reduce((s, x, i) => s + w[i] * x.mean, 0) / W
  const A = g.reduce((s, x, i) => s + w[i] * (x.mean - mw) ** 2, 0) / (k - 1)
  const tmp = g.reduce((s, x, i) => s + (1 - w[i] / W) ** 2 / (x.n - 1), 0)
  const F = A / (1 + ((2 * (k - 2)) / (k * k - 1)) * tmp)
  const df2 = (k * k - 1) / (3 * tmp)
  return result("Welch's ANOVA", `F (${k - 1}, ${fmt(df2)}) = ${fmt(F)}`, fCdfUpper(F, k - 1, df2))
}

export function kruskalWallis(groups: number[][]): TestResult | null {
  const valid = groups.filter((x) => x.length > 0)
  const k = valid.length
  const all = valid.flat()
  const N = all.length
  if (k < 2 || N < 3) return null
  const { ranks, tieSum } = rankAll(all)
  let off = 0
  let sum = 0
  for (const g of valid) {
    const r = ranks.slice(off, off + g.length).reduce((s, x) => s + x, 0)
    sum += (r * r) / g.length
    off += g.length
  }
  const H = ((12 / (N * (N + 1))) * sum - 3 * (N + 1)) / (1 - tieSum / (N * N * N - N) || 1)
  return result("Kruskal–Wallis test", `H = ${fmt(H)}, df = ${k - 1}`, chiSquareUpper(H, k - 1))
}

// --- multiple comparisons ---------------------------------------------------------------

/** Distribution of the studentized range: P(Q < q) for k means and df error degrees of freedom. */
export function ptukey(q: number, k: number, df: number) {
  if (q <= 0) return 0
  const W = (w: number) => {
    if (w <= 0) return 0
    const v = k * simpson((z) => normPdf(z) * Math.max(0, normCdf(z) - normCdf(z - w)) ** (k - 1), -8, 8, 160)
    return Math.min(1, v)
  }
  return overS(df, (s) => W(q * s))
}

/** P(max_j |T_j| < c) for Dunnett's many-to-one comparisons; lambda_j = sqrt(n_j / (n_j + n_control)). */
export function pdunnett(c: number, lambdas: number[], df: number) {
  const inner = (cs: number) =>
    simpson(
      (z) => {
        let prod = normPdf(z)
        for (const l of lambdas) {
          const sd = Math.sqrt(1 - l * l)
          prod *= Math.max(0, normCdf((l * z + cs) / sd) - normCdf((l * z - cs) / sd))
        }
        return prod
      },
      -8,
      8,
      160,
    )
  return overS(df, (s) => inner(c * s))
}

export type PostHoc = "Holm–Šídák" | "Tukey" | "Bonferroni" | "Dunnett (vs control)" | "None"

function pooled(groups: number[][]) {
  const valid = groups.filter((g) => g.length > 0)
  const N = valid.reduce((s, g) => s + g.length, 0)
  const df = N - valid.length
  const ssw = valid.reduce((s, g) => {
    const m = mean(g)
    return s + g.reduce((a, v) => a + (v - m) ** 2, 0)
  }, 0)
  return { mse: df > 0 ? ssw / df : NaN, df }
}

const finish = (c: Omit<Comparison, "summary">): Comparison => ({ ...c, p: Math.min(1, Math.max(0, c.p)), summary: stars(Math.min(1, Math.max(0, c.p))) })

export function tukeyHSD(groups: number[][]): Comparison[] {
  const { mse, df } = pooled(groups)
  const k = groups.filter((g) => g.length).length
  if (!(mse > 0) || df < 1 || k < 3) return []
  const out: Comparison[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      if (!groups[i].length || !groups[j].length) continue
      const diff = mean(groups[j]) - mean(groups[i])
      const q = Math.abs(diff) / Math.sqrt((mse / 2) * (1 / groups[i].length + 1 / groups[j].length))
      out.push(finish({ a: i, b: j, diff, p: 1 - ptukey(q, k, df) }))
    }
  return out
}

export function gamesHowell(groups: number[][]): Comparison[] {
  const k = groups.filter((g) => g.length >= 2).length
  if (k < 3) return []
  const out: Comparison[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = summarize(groups[i])
      const b = summarize(groups[j])
      if (a.n < 2 || b.n < 2) continue
      const va = a.sd ** 2 / a.n
      const vb = b.sd ** 2 / b.n
      if (va + vb === 0) continue
      const diff = b.mean - a.mean
      const q = Math.abs(diff) / Math.sqrt((va + vb) / 2)
      const dfij = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1))
      out.push(finish({ a: i, b: j, diff, p: 1 - ptukey(q, k, dfij) }))
    }
  return out
}

export function bonferroni(groups: number[][]): Comparison[] {
  const { mse, df } = pooled(groups)
  if (!(mse > 0) || df < 1) return []
  const raw: Omit<Comparison, "summary">[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      if (!groups[i].length || !groups[j].length) continue
      const diff = mean(groups[j]) - mean(groups[i])
      raw.push({ a: i, b: j, diff, p: tTwoSidedP(diff / Math.sqrt(mse * (1 / groups[i].length + 1 / groups[j].length)), df) })
    }
  return raw.map((c) => finish({ ...c, p: c.p * raw.length }))
}

/** Dunnett: every group vs the first (control) group, family-wise error controlled exactly. */
export function dunnett(groups: number[][], control = 0): Comparison[] {
  const { mse, df } = pooled(groups)
  const ctrl = groups[control]
  if (!(mse > 0) || df < 1 || !ctrl?.length) return []
  const others = groups.map((g, i) => ({ g, i })).filter((x) => x.i !== control && x.g.length)
  const lambdas = others.map((x) => Math.sqrt(x.g.length / (x.g.length + ctrl.length)))
  return others.map((x) => {
    const diff = mean(x.g) - mean(ctrl)
    const t = Math.abs(diff) / Math.sqrt(mse * (1 / x.g.length + 1 / ctrl.length))
    return finish({ a: control, b: x.i, diff, p: 1 - pdunnett(t, lambdas, df) })
  })
}

/** Dunn's test after Kruskal–Wallis (Bonferroni-adjusted, as in Prism). */
export function dunn(groups: number[][]): Comparison[] {
  const all = groups.flat()
  const N = all.length
  if (groups.filter((g) => g.length).length < 3) return []
  const { ranks, tieSum } = rankAll(all)
  const meanRank: number[] = []
  let off = 0
  for (const g of groups) {
    meanRank.push(g.length ? ranks.slice(off, off + g.length).reduce((s, r) => s + r, 0) / g.length : NaN)
    off += g.length
  }
  const v = (N * (N + 1)) / 12 - tieSum / (12 * (N - 1))
  const raw: Omit<Comparison, "summary">[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      if (!groups[i].length || !groups[j].length) continue
      const z = (meanRank[j] - meanRank[i]) / Math.sqrt(v * (1 / groups[i].length + 1 / groups[j].length))
      raw.push({ a: i, b: j, diff: mean(groups[j]) - mean(groups[i]), p: 2 * (1 - normCdf(Math.abs(z))) })
    }
  return raw.map((c) => finish({ ...c, p: c.p * raw.length }))
}

// --- assumption checks ----------------------------------------------------------------------

/** Shapiro–Wilk W and P (Royston 1995 approximation, n = 3…5000). */
export function shapiroWilk(values: number[]): { W: number; p: number } | null {
  const x = [...values].sort((a, b) => a - b)
  const n = x.length
  if (n < 3 || n > 5000 || x[n - 1] - x[0] === 0) return null
  const m = Array.from({ length: n }, (_, i) => normInv((i + 1 - 0.375) / (n + 0.25)))
  const mm = m.reduce((s, v) => s + v * v, 0)
  const u = 1 / Math.sqrt(n)
  const a = new Array<number>(n).fill(0)
  const poly = (c: number[], v: number) => c.reduce((s, ci, i) => s + ci * v ** i, 0)
  const an = poly([0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056], u) + m[n - 1] / Math.sqrt(mm)
  if (n === 3) {
    a[0] = -Math.SQRT1_2
    a[2] = Math.SQRT1_2
  } else if (n <= 5) {
    const phi = (mm - 2 * m[n - 1] ** 2) / (1 - 2 * an * an)
    for (let i = 1; i < n - 1; i++) a[i] = m[i] / Math.sqrt(phi)
    a[n - 1] = an
    a[0] = -an
  } else {
    const an1 = poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], u) + m[n - 2] / Math.sqrt(mm)
    const phi = (mm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an * an - 2 * an1 * an1)
    for (let i = 2; i < n - 2; i++) a[i] = m[i] / Math.sqrt(phi)
    a[n - 1] = an
    a[0] = -an
    a[n - 2] = an1
    a[1] = -an1
  }
  const mx = mean(x)
  const W = Math.min(1, x.reduce((s, v, i) => s + a[i] * v, 0) ** 2 / x.reduce((s, v) => s + (v - mx) ** 2, 0))
  let p: number
  if (n === 3) p = Math.max(0, Math.min(1, (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)))))
  else if (n <= 11) {
    const g = -2.273 + 0.459 * n
    const mu = 0.544 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n ** 3
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n ** 3)
    const arg = g - Math.log(1 - W)
    p = arg > 0 ? 1 - normCdf((-Math.log(arg) - mu) / sigma) : 0
  } else {
    const L = Math.log(n)
    const mu = -1.5861 - 0.31082 * L - 0.083751 * L * L + 0.0038915 * L ** 3
    const sigma = Math.exp(-0.4803 - 0.082676 * L + 0.0030302 * L * L)
    p = 1 - normCdf((Math.log(1 - W) - mu) / sigma)
  }
  return { W, p: Math.max(0, Math.min(1, p)) }
}

/** Grubbs' test for one outlier (two-sided). Returns the most extreme value and its P value. */
export function grubbs(values: number[]): { value: number; G: number; p: number } | null {
  const s = summarize(values)
  const n = s.n
  if (n < 3 || s.sd === 0) return null
  const value = values.reduce((best, v) => (Math.abs(v - s.mean) > Math.abs(best - s.mean) ? v : best), values[0])
  const G = Math.abs(value - s.mean) / s.sd
  const den = (n - 1) ** 2 - n * G * G
  if (den <= 0) return { value, G, p: 0 }
  const t = Math.sqrt((n * (n - 2) * G * G) / den)
  return { value, G, p: Math.min(1, n * tTwoSidedP(t, n - 2)) }
}
