/**
 * Everything the search bar can find: analyses, statistical tests, graph types,
 * sample experiments and app features — each with what to do when picked.
 */
import { ANALYSES, type AnalysisId } from "./analysis-defs"
import type { ChartType } from "./graphSpec"
import { SAMPLE_EXPERIMENTS } from "./samples"

export type SearchAction =
  | { kind: "analysis"; analysis: AnalysisId; params?: Record<string, string>; chartType?: ChartType }
  /** A test that may live in several analyses; the first that fits the data is used. */
  | { kind: "test"; analyses: AnalysisId[]; params: Record<string, string> }
  | { kind: "sample"; index: number }
  | { kind: "feature"; feature: "export" | "colors" | "text" | "fullscreen" | "logy" | "filter" | "rename" | "apikey" | "legend" | "cleanup" | "upload" }

export type SearchEntry = { id: string; type: "Analysis" | "Test" | "Graph" | "Sample" | "Feature"; title: string; subtitle: string; keywords: string; action: SearchAction }

const GROUPS: AnalysisId[] = ["one_factor", "column"]
const PAIRED: AnalysisId[] = ["paired"]

const TESTS: Omit<SearchEntry, "id" | "type">[] = [
  { title: "Unpaired t test (Welch)", subtitle: "Two groups, unequal SDs allowed", keywords: "t test ttest welch unpaired two groups compare means independent", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA" } } },
  { title: "Student's t test", subtitle: "Two groups, equal SDs", keywords: "t test ttest student unpaired equal variance pooled", action: { kind: "test", analyses: GROUPS, params: { test: "Student t / ANOVA" } } },
  { title: "One-way ANOVA", subtitle: "Three or more groups", keywords: "anova one way f test compare groups means", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA" } } },
  { title: "Welch's ANOVA + Games–Howell", subtitle: "Three or more groups, unequal SDs", keywords: "welch anova games howell unequal variances heteroscedastic", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / Welch ANOVA" } } },
  { title: "Mann–Whitney test", subtitle: "Non-parametric, two groups", keywords: "mann whitney u test wilcoxon rank sum nonparametric non-parametric ranks two groups median", action: { kind: "test", analyses: GROUPS, params: { test: "Mann–Whitney / Kruskal–Wallis" } } },
  { title: "Kruskal–Wallis test + Dunn's", subtitle: "Non-parametric, three or more groups", keywords: "kruskal wallis dunn nonparametric non-parametric ranks anova on ranks", action: { kind: "test", analyses: GROUPS, params: { test: "Mann–Whitney / Kruskal–Wallis" } } },
  { title: "Tukey's multiple comparisons", subtitle: "All pairs after ANOVA", keywords: "tukey hsd post hoc posthoc pairwise multiple comparisons", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA", posthoc: "Tukey" } } },
  { title: "Dunnett's test (vs control)", subtitle: "Each group vs control after ANOVA", keywords: "dunnett control many to one post hoc posthoc multiple comparisons", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA", posthoc: "Dunnett (vs control)" } } },
  { title: "Bonferroni correction", subtitle: "Pairwise t tests, Bonferroni-adjusted", keywords: "bonferroni correction adjusted post hoc posthoc multiple comparisons", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA", posthoc: "Bonferroni" } } },
  { title: "Holm–Šídák multiple comparisons", subtitle: "Pairwise after ANOVA (default)", keywords: "holm sidak šídák post hoc posthoc multiple comparisons", action: { kind: "test", analyses: GROUPS, params: { test: "Welch t / ANOVA", posthoc: "Holm–Šídák" } } },
  { title: "Paired t test", subtitle: "Same subjects, two conditions", keywords: "paired t test matched before after dependent repeated", action: { kind: "test", analyses: PAIRED, params: { test: "Paired t / RM ANOVA" } } },
  { title: "Repeated-measures ANOVA", subtitle: "Same subjects, three or more conditions", keywords: "repeated measures rm anova within subjects longitudinal", action: { kind: "test", analyses: PAIRED, params: { test: "Paired t / RM ANOVA" } } },
  { title: "Wilcoxon signed-rank test", subtitle: "Non-parametric paired test", keywords: "wilcoxon signed rank matched pairs nonparametric non-parametric paired", action: { kind: "test", analyses: PAIRED, params: { test: "Wilcoxon / Friedman" } } },
  { title: "Friedman test", subtitle: "Non-parametric repeated measures", keywords: "friedman nonparametric non-parametric repeated measures ranks", action: { kind: "test", analyses: PAIRED, params: { test: "Wilcoxon / Friedman" } } },
  { title: "Two-way ANOVA", subtitle: "Two factors + interaction", keywords: "two way anova factorial interaction genotype treatment sex", action: { kind: "analysis", analysis: "two_way" } },
  { title: "Log-rank test", subtitle: "Compare survival curves", keywords: "log rank mantel cox survival kaplan meier compare curves", action: { kind: "analysis", analysis: "survival" } },
  { title: "Chi-square test", subtitle: "Counts / proportions", keywords: "chi square chi-squared contingency proportions counts", action: { kind: "analysis", analysis: "contingency" } },
  { title: "Fisher's exact test", subtitle: "2 × 2 counts", keywords: "fisher exact 2x2 contingency odds ratio", action: { kind: "analysis", analysis: "contingency" } },
  { title: "Pearson / Spearman correlation", subtitle: "Association between two measures", keywords: "pearson spearman correlation r rho association relationship", action: { kind: "analysis", analysis: "correlation" } },
  { title: "Linear regression", subtitle: "Fit a straight line", keywords: "linear regression slope intercept r squared fit line", action: { kind: "analysis", analysis: "xy", params: { fit: "linear" } } },
  { title: "Nonlinear fit: IC50 / EC50 (4PL)", subtitle: "Dose–response curve", keywords: "ic50 ec50 4pl four parameter logistic sigmoid dose response hill slope potency", action: { kind: "analysis", analysis: "dose_response" } },
  { title: "Normality test (Shapiro–Wilk)", subtitle: "Shown with every group comparison", keywords: "normality normal distribution shapiro wilk gaussian assumption check", action: { kind: "test", analyses: GROUPS, params: {} } },
  { title: "Outlier test (Grubbs)", subtitle: "Shown with every group comparison", keywords: "outlier grubbs extreme value rout", action: { kind: "test", analyses: GROUPS, params: {} } },
]

const GRAPHS: Omit<SearchEntry, "id" | "type">[] = [
  { title: "Bar graph with dots", subtitle: "Mean ± error with individual values", keywords: "bar chart column graph mean error bars dots", action: { kind: "test", analyses: GROUPS, params: {} } },
  { title: "Scatter dot plot", subtitle: "Every value with mean ± error", keywords: "dot plot scatter strip plot individual values beeswarm", action: { kind: "analysis", analysis: "one_factor", chartType: "scatter" } },
  { title: "Box and whiskers", subtitle: "Median, IQR, min–max", keywords: "box plot boxplot whiskers median quartiles", action: { kind: "analysis", analysis: "one_factor", chartType: "box" } },
  { title: "Violin plot", subtitle: "Distribution shape per group", keywords: "violin distribution density", action: { kind: "analysis", analysis: "one_factor", chartType: "violin" } },
  { title: "Split violin", subtitle: "Two sub-groups per category (e.g. sex)", keywords: "split violin male female two sides", action: { kind: "analysis", analysis: "two_way", chartType: "violin" } },
  { title: "Grouped bar graph", subtitle: "Two factors side by side", keywords: "grouped bar clustered bars two factors", action: { kind: "analysis", analysis: "two_way" } },
  { title: "Before–after plot", subtitle: "Lines joining paired values", keywords: "before after paired slope connected lines spaghetti", action: { kind: "analysis", analysis: "paired" } },
  { title: "Line graph / time course", subtitle: "Mean ± error over time", keywords: "line graph time course xy over time kinetics trace", action: { kind: "analysis", analysis: "xy" } },
  { title: "Histogram", subtitle: "Frequency distribution", keywords: "histogram frequency distribution bins", action: { kind: "analysis", analysis: "histogram" } },
  { title: "Heatmap", subtitle: "Genes × samples, z-scores, clustering", keywords: "heatmap heat map matrix clustering z score expression", action: { kind: "analysis", analysis: "matrix_heatmap" } },
  { title: "Kaplan–Meier curve", subtitle: "Survival over time", keywords: "kaplan meier survival curve km", action: { kind: "analysis", analysis: "survival" } },
  { title: "Volcano plot", subtitle: "Fold change vs significance", keywords: "volcano omics rna seq differential expression", action: { kind: "analysis", analysis: "volcano" } },
  { title: "Pie / donut chart", subtitle: "Parts of a whole", keywords: "pie donut doughnut proportion composition parts", action: { kind: "analysis", analysis: "parts" } },
  { title: "Stacked percent bars", subtitle: "Proportions per group", keywords: "stacked bar 100% proportions percent", action: { kind: "analysis", analysis: "contingency" } },
  { title: "Waterfall plot", subtitle: "% change per subject", keywords: "waterfall recist tumor response change from baseline", action: { kind: "analysis", analysis: "waterfall" } },
  { title: "Forest plot", subtitle: "Estimates with confidence intervals", keywords: "forest plot hazard ratio odds ratio meta analysis subgroup ci", action: { kind: "analysis", analysis: "forest" } },
  { title: "UMAP / t-SNE / PCA plot", subtitle: "Points colored by cluster", keywords: "umap tsne t-sne pca dimensionality reduction clusters single cell", action: { kind: "analysis", analysis: "scatter_groups" } },
]

const FEATURES: Omit<SearchEntry, "id" | "type">[] = [
  { title: "Upload a CSV or Excel file", subtitle: "Start with your own data", keywords: "upload import open file csv excel xlsx drop", action: { kind: "feature", feature: "upload" } },
  { title: "Export graph (PDF, SVG, PNG)", subtitle: "Journal, slide and poster sizes", keywords: "export download save pdf svg png tiff image figure publication dpi", action: { kind: "feature", feature: "export" } },
  { title: "Change colors", subtitle: "Palettes and per-group colors", keywords: "colors colour palette theme colorblind grayscale", action: { kind: "feature", feature: "colors" } },
  { title: "Edit or add text on the graph", subtitle: "Rename labels, add annotations", keywords: "text label annotation rename legend title edit", action: { kind: "feature", feature: "text" } },
  { title: "Full screen", subtitle: "Preview export shapes", keywords: "full screen fullscreen large preview", action: { kind: "feature", feature: "fullscreen" } },
  { title: "Log scale (Y axis)", subtitle: "Switch the Y axis to log", keywords: "log scale logarithmic axis y axis", action: { kind: "feature", feature: "logy" } },
  { title: "Filter / exclude groups", subtitle: "Leave out or keep only some values", keywords: "filter exclude remove group subset keep only", action: { kind: "feature", feature: "filter" } },
  { title: "Rename columns", subtitle: "Edit column names in the data", keywords: "rename columns column names header", action: { kind: "feature", feature: "rename" } },
  { title: "Figure legend & methods text", subtitle: "Ready-to-copy text for papers", keywords: "legend methods statistical methods text caption paper write", action: { kind: "feature", feature: "legend" } },
  { title: "Clean up messy data (AI)", subtitle: "Fix group names, units, summary rows", keywords: "clean cleanup messy fix data typos units ai", action: { kind: "feature", feature: "cleanup" } },
  { title: "API key settings", subtitle: "Gemini, OpenAI or Claude", keywords: "api key ai settings gemini openai claude anthropic byok", action: { kind: "feature", feature: "apikey" } },
]

export const SEARCH_INDEX: SearchEntry[] = [
  ...ANALYSES.map((a): SearchEntry => ({ id: `a:${a.id}`, type: "Analysis", title: a.label, subtitle: a.group, keywords: `${a.description} ${a.id.replace(/_/g, " ")}`, action: { kind: "analysis", analysis: a.id } })),
  ...TESTS.map((t, i): SearchEntry => ({ ...t, id: `t:${i}`, type: "Test" })),
  ...GRAPHS.map((g, i): SearchEntry => ({ ...g, id: `g:${i}`, type: "Graph" })),
  ...SAMPLE_EXPERIMENTS.map((e, i): SearchEntry => ({ id: `s:${i}`, type: "Sample", title: e.title, subtitle: e.experiment, keywords: `${e.description} ${e.file}`, action: { kind: "sample", index: i } })),
  ...FEATURES.map((f, i): SearchEntry => ({ ...f, id: `f:${i}`, type: "Feature" })),
]

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—-]/g, " ").replace(/[^a-z0-9%² ]+/g, " ")

/** Simple ranked search: every query word must appear (as a prefix of a word) in title or keywords; title hits rank higher. */
export function search(query: string, limit = 12): SearchEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { e: SearchEntry; score: number }[] = []
  for (const e of SEARCH_INDEX) {
    const title = ` ${fold(e.title)}`
    const all = `${title} ${fold(e.subtitle)} ${fold(e.keywords)}`
    let score = 0
    let ok = true
    for (const w of words) {
      // Very short words ("u", "t", "km") must match a whole word, longer ones a word start.
      const at = (hay: string) => (w.length <= 2 ? `${hay} `.includes(` ${w} `) : hay.includes(` ${w}`))
      if (at(title)) score += 10
      else if (at(all)) score += 4
      else if (w.length > 2 && all.includes(w)) score += 1
      else {
        ok = false
        break
      }
    }
    if (!ok) continue
    const phrase = words.join(" ")
    if (title.trim().startsWith(phrase)) score += 8
    if (words.length > 1 && fold(e.keywords).includes(phrase)) score += 6
    score += { Test: 3, Analysis: 2, Graph: 2, Feature: 1, Sample: 0 }[e.type]
    scored.push({ e, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.e)
}
