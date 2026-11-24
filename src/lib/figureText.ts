/**
 * Figure legend and statistical-methods paragraph, written from the graph
 * settings and the app's own computed results — no AI, so it's free and the
 * numbers always match the graph.
 */
import { analysisById } from "./analysis-defs"
import type { Result } from "./analyses"
import type { GraphSpec } from "./graphSpec"
import type { ChartSpec, ColumnChartSpec } from "./specs"
import { fmt, fmtP } from "./stats"

export type FigureText = { legend: string; methods: string }

const STARS = "*P < 0.05, **P < 0.01, ***P < 0.001, ****P < 0.0001; ns, not significant."
const errName = (e: string) => (e === "sem" ? "SEM" : e === "ci" ? "95% confidence interval" : "SD")

function nRange(c: ColumnChartSpec) {
  const ns = c.groups.map((g) => g.values.length).filter((n) => n > 0)
  if (!ns.length) return ""
  const lo = Math.min(...ns)
  const hi = Math.max(...ns)
  return lo === hi ? `n = ${lo} per group` : `n = ${lo}–${hi} per group`
}

function styleSentence(c: ColumnChartSpec) {
  if (c.style === "box") return "Boxes show the median and interquartile range; whiskers show the minimum and maximum; dots are individual values."
  if (c.style === "violin") return "Violins show the distribution of values with the median (solid line) and quartiles (dashed lines); dots are individual values."
  if (c.style === "scatter") return `Dots are individual values; lines show the mean ± ${errName(c.error)}.`
  return `Bars show the mean ± ${errName(c.error)}; dots are individual values.`
}

function testSentence(c: ColumnChartSpec) {
  if (!c.test) return ""
  const p = c.test.p < 0.0001 ? "P < 0.0001" : `P = ${fmtP(c.test.p)}`
  const sig = c.comparisons?.filter((x) => x.p < 0.05).length ?? 0
  const comp = c.comparisons?.length ? ` ${c.comparisonMethod ?? "Holm–Šídák"} multiple comparisons: ${sig} of ${c.comparisons.length} ${c.comparisonMethod?.startsWith("Dunnett") ? "comparisons with the control" : "pairs"} differ (brackets).` : ""
  return `${c.test.name}: ${c.test.statistic}, ${p}.${comp}`
}

function filterSentence(spec: GraphSpec) {
  if (!spec.filters.length) return ""
  const parts = spec.filters.map((f) => (f.op === "exclude" ? `${f.values?.join(", ")} (${f.column}) excluded` : f.op === "include" ? `only ${f.values?.join(", ")} (${f.column}) shown` : `${f.column} ${f.op === "min" ? "≥" : "≤"} ${f.value}`))
  return ` Data shown: ${parts.join("; ")}.`
}

const num = (v: unknown) => (typeof v === "number" ? fmt(v) : String(v ?? "–"))
/** Key fitted values worth stating in a curve's legend, read from the computed tables. */
const EXTRAS: Record<string, (r: Result) => string> = {
  dose_response: (r) => { const t = r.tables[0]; if (!t) return ""; const col = t.columns[4]; return `${col}: ${t.rows.map((row) => `${row[0]} ${num(row[4])}`).join("; ")}.` },
  kinetics: (r) => { const row = r.tables[0]?.rows[0]; return row ? `Vmax = ${num(row[0])}, Km = ${num(row[1])} (R² = ${num(row[2])}).` : "" },
  survival: (r) => { const t = r.tables[0]; return t ? `Median survival: ${t.rows.map((row) => `${row[0]} ${num(row[4])}`).join("; ")}.` : "" },
  pk: (r) => { const t = r.tables[0]; return t ? `t½: ${t.rows.map((row) => `${row[0]} ${num(row[5])}`).join("; ")}.` : "" },
  growth: (r) => { const t = r.tables[0]; return t ? `Doubling time: ${t.rows.map((row) => `${row[0]} ${num(row[2])}`).join("; ")}.` : "" },
  melt: (r) => { const t = r.tables[0]; return t ? `Tm: ${t.rows.map((row) => `${row[0]} ${num(row[1] ?? row[2])}`).join("; ")}.` : "" },
  qpcr_standard: (r) => { const t = r.tables[0]; return t ? `Efficiency: ${t.rows.map((row) => `${row[0]} ${num(row[4])}%`).join("; ")}.` : "" },
}
const prose = (s: string) => s.replace(/ · /g, "; ")

function legendFor(chart: ChartSpec | undefined, spec: GraphSpec, result: Result): string {
  if (!chart) return ""
  const title = chart.title.replace(/\.$/, "")
  if (chart.kind === "column") {
    const groups = chart.groups.map((g) => g.name)
    const intro = `${title}${groups.length <= 6 ? ` in ${groups.join(", ")}` : ` across ${groups.length} groups`} (${nRange(chart)}).`
    const paired = chart.paired ? " Lines join measurements from the same subject." : ""
    return [intro, styleSentence(chart) + paired, testSentence(chart), chart.test || chart.comparisons?.length ? STARS : ""].filter(Boolean).join(" ") + filterSentence(spec)
  }
  if (chart.kind === "grouped") return `${title}. ${chart.note ? prose(chart.note) + "." : ""} ${prose(result.headline)}.`.replace(/\s+/g, " ").trim() + filterSentence(spec)
  if (chart.kind === "xy") {
    const extra = EXTRAS[spec.analysis]?.(result) ?? ""
    return `${title}. ${chart.note ? prose(chart.note) + "." : ""} ${extra || prose(result.headline) + "."}`.replace(/\s+/g, " ").replace(/\.\./g, ".").trim() + filterSentence(spec)
  }
  if (chart.kind === "heatmap") return `${title}. ${result.headline}. Color scale: ${chart.legendLabel ?? "value"}.` + filterSentence(spec)
  if (chart.kind === "bars") return `${title}. ${result.headline}.${chart.note ? ` ${chart.note}.` : ""}` + filterSentence(spec)
  if (chart.kind === "split") return `${title}. Left and right halves show ${chart.sides.join(" and ")}; lines show medians. ${result.headline}.` + filterSentence(spec)
  return `${title}. ${result.headline}.` + filterSentence(spec)
}

const METHODS: Record<string, (spec: GraphSpec, chart: ChartSpec | undefined) => string> = {
  column: (s, c) => groupMethods(s, c),
  one_factor: (s, c) => groupMethods(s, c),
  paired: (s) =>
    (s.params.test ?? "").startsWith("Wilcoxon")
      ? "Measurements from the same subjects were compared with the Wilcoxon matched-pairs signed-rank test (two time points; exact P for n ≤ 30 without ties) or the Friedman test (three or more), using subjects with complete data."
      : `Measurements from the same subjects were compared with a paired t test (two time points) or repeated-measures one-way ANOVA (three or more), using subjects with complete data; normality of the paired differences was checked with the Shapiro–Wilk test. Data are shown as individual values with ${errName(s.errorBars)}.`,
  two_way: () => "Effects of the two factors and their interaction were tested by two-way ANOVA with type III sums of squares. Bars show cell means.",
  summary_bars: (s) => `Summary data (mean, ${s.params.errorType === "sem" ? "SEM" : "SD"} and n) were plotted as reported; where two groups were present they were compared with Welch's t test computed from the summary statistics.`,
  xy: (s) => `Replicate columns were averaged at each X value and shown as mean ± ${errName(s.errorBars)}.${s.params.normalize && s.params.normalize !== "none" ? ` Traces were normalized as ${s.params.normalize}.` : ""}${s.params.fit === "linear" ? " Lines are least-squares linear regressions." : s.params.fit === "initial rate" ? " Initial rates are least-squares slopes over the first 25% of X values." : ""}`,
  time_course: (s) => `Values were averaged per time point and group and shown as mean ± ${errName(s.errorBars)}.`,
  dose_response: () => "Dose–response curves were fitted with a four-parameter logistic model (bottom, top, log EC50/IC50, Hill slope) on log10-transformed dose by least squares.",
  standard_curve: (s) => `A ${s.params.fit === "linear" ? "linear" : s.params.fit === "4pl" ? "four-parameter logistic" : "linear (or four-parameter logistic when R² < 0.98)"} standard curve was fitted to the standards and unknown concentrations were interpolated from it; values outside the standard range are flagged.`,
  kinetics: () => "Initial velocities were fitted to the Michaelis–Menten equation by nonlinear least squares to estimate Vmax and Km.",
  survival: () => "Survival was estimated by the Kaplan–Meier method (censored subjects shown as ticks) and curves were compared with the log-rank (Mantel–Cox) test.",
  contingency: () => "Associations between categorical variables were tested with the chi-square test, and with Fisher's exact test for 2 × 2 tables.",
  parts: () => "Values are shown as percentages of the total.",
  histogram: (s) => `Values were binned into a frequency distribution (${s.params.bins === "log" ? "log-spaced bins" : "Freedman–Diaconis bin width"}); the dashed curve is a normal distribution with the same mean and SD.`,
  correlation: () => "Correlations were assessed with Pearson's r (two-sided P) and Spearman's rank correlation; lines are least-squares linear regressions.",
  bland_altman: () => "Agreement between methods was assessed by Bland–Altman analysis: bias (mean difference) and 95% limits of agreement (bias ± 1.96 SD).",
  qpcr: (s) => `Relative expression was calculated by the 2^−ΔΔCt method, normalizing each target to ${s.params.reference ?? "the reference gene"} and to the ${s.params.control ?? "control"} condition; bars show mean ± SD of replicates.`,
  plate: () => "Well values are shown as a plate heatmap; row and column means and the plate-wide coefficient of variation were calculated to check for positional effects.",
  volcano: (s) => `Features were classed as up- or down-regulated when |log2 fold change| ≥ ${s.params.fcCutoff ?? "1"} and P < ${s.params.pCutoff ?? "0.05"}.`,
  ma_plot: (s) => `Log2 fold change was plotted against mean expression; features with P < ${s.params.pCutoff ?? "0.05"} are colored.`,
  matrix_heatmap: (s) => `Values were ${s.params.scale === "row z-score" ? "converted to row z-scores" : s.params.scale === "log2(x+1)" ? "log2(x+1)-transformed" : "shown as measured"}${s.params.cluster && s.params.cluster !== "none" ? ` and ${s.params.cluster} were ordered by average-linkage hierarchical clustering on 1 − Pearson r` : ""}.`,
  synergy: () => "Drug interaction was assessed with the Bliss independence model; positive Bliss excess (observed − expected inhibition) indicates synergy.",
  pca: (s) => `Principal component analysis was performed on ${s.params.orientation === "columns" ? "log2-transformed values with samples as observations" : "standardized (z-scored) variables"}; the score plot shows the first two components.`,
  scatter_groups: () => "Points are plotted at the given coordinates and colored by group; dense regions are shaded by point density.",
  pk: () => "Pharmacokinetic parameters were derived by non-compartmental analysis: Cmax and Tmax from observed data, AUC by the linear trapezoidal rule, λz by log-linear regression of the last three points, t½ = ln2/λz and AUC0–∞ = AUC0–t + Clast/λz.",
  growth: () => "The maximum specific growth rate (µmax) was the steepest slope of ln(OD) over a sliding window; doubling time = ln2/µmax and lag time was estimated by the tangent method.",
  melt: () => "Melting temperatures (Tm) were taken as the midpoint of a sigmoidal (four-parameter logistic) fit to the main transition, or the peak of the first derivative.",
  amplification: (s) => `Fluorescence was baseline-corrected using cycles 3–15; Cq was the interpolated cycle at which each curve crossed a common threshold (${s.params.threshold ?? "10 SD of baseline"}).`,
  chromatogram: (s) => `Peaks above ${s.params.minHeight ?? "5"}% of the maximum signal were detected; areas were integrated by the trapezoidal rule above baseline and reported as % of total area.`,
  qpcr_standard: () => "Standard curves were fitted by linear regression of Ct on log10 template quantity; amplification efficiency = 10^(−1/slope) − 1, and unknown quantities were interpolated from the curve.",
  zprime: (s) => `Assay quality was calculated per plate from ${s.params.positive ?? "positive"} and ${s.params.negative ?? "negative"} control wells: Z′ = 1 − 3(σ+ + σ−)/|µ+ − µ−|, signal-to-background, signal-to-noise and %CV.`,
  waterfall: () => "Each bar is one subject's best percentage change from baseline; dashed lines mark +20% (progression) and −30% (response) thresholds.",
  forest: (s) => `Estimates are shown with 95% confidence intervals on a ${s.params.scale?.startsWith("ratio") ? "log scale with a reference line at 1" : "linear scale with a reference line at 0"}.`,
  ranked_bars: (s) => `The top ${s.params.top ?? "25"} entries are ranked by score.`,
}

function groupMethods(s: GraphSpec, c: ChartSpec | undefined) {
  const norm = [s.roles.normalizer?.[0] ? `values were divided by ${s.roles.normalizer[0]}` : "", s.params.normalize && s.params.normalize !== "none" ? `expressed as ${s.params.normalize}${s.params.control ? ` (${s.params.control})` : ""}` : ""].filter(Boolean).join(" and ")
  const groups = c?.kind === "column" ? c.groups.filter((g) => g.values.length).length : 0
  const kind = s.params.test ?? "Welch t / ANOVA"
  const method = c?.kind === "column" ? c.comparisonMethod : undefined
  const post: Record<string, string> = {
    "Holm–Šídák": "Holm–Šídák multiple comparisons using the pooled variance",
    Tukey: "Tukey's honestly significant difference test",
    Bonferroni: "Bonferroni-corrected pairwise t tests using the pooled variance",
    "Dunn's": "Dunn's multiple comparisons (Bonferroni-adjusted)",
    "Games–Howell": "Games–Howell multiple comparisons (unequal variances)",
  }
  const postText = method ? post[method] ?? (method.startsWith("Dunnett") ? `Dunnett's test comparing each group with ${method.replace(/^Dunnett \(vs (.*)\)$/, "$1")}` : method) : ""
  let test = ""
  if (groups === 2)
    test = kind.startsWith("Mann") ? "Two groups were compared with the two-sided Mann–Whitney test (exact P for samples ≤ 25 without ties)." : kind.startsWith("Student") ? "Two groups were compared with Student's unpaired t test (equal variances assumed)." : "Two groups were compared with Welch's unpaired t test (unequal variances allowed)."
  else if (groups > 2) {
    const omnibus = kind.startsWith("Mann") ? "the Kruskal–Wallis test" : kind === "Welch t / Welch ANOVA" ? "Welch's ANOVA" : "ordinary one-way ANOVA"
    test = `Groups were compared by ${omnibus}${postText ? `, followed by ${postText}` : ""}.`
  }
  const checks = kind.startsWith("Mann") ? "" : " Normality was assessed with the Shapiro–Wilk test and outliers with Grubbs' test (α = 0.05)."
  return `${norm ? `Before analysis, ${norm}. ` : ""}${test}${checks}`
}

export function figureText(spec: GraphSpec, result: Result, charts: ChartSpec[], rowsUsed: number, rowsTotal: number): FigureText {
  const def = analysisById(spec.analysis)
  const chart = charts[0]
  const methodsCore = (METHODS[spec.analysis]?.(spec, chart) ?? def?.description ?? "").trim()
  const filtered = spec.filters.length ? ` Analysis used ${rowsUsed} of ${rowsTotal} rows after the filters described in the legend were applied.` : ""
  const methods = `Statistical analysis. ${methodsCore}${filtered} Two-sided P < 0.05 was considered significant. Analyses were performed in BenchPlot.`.replace(/\s+/g, " ")
  return { legend: legendFor(chart, spec, result).replace(/\s+/g, " ").trim(), methods }
}
