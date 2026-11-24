/**
 * Sample experiments: one (or more) per analysis, each a typical use of that
 * graph. Loading a sample opens its analysis with the settings that suit it.
 */
import type { AnalysisId } from "./analysis-defs"
import type { ColumnStyle, ErrorKind } from "./specs"
import type { Params, Roles } from "./helpers"

export type SampleExperiment = {
  file: string
  title: string
  /** The kind of experiment, e.g. "In vivo efficacy", "RT-qPCR". */
  experiment: string
  /** What was measured and how it is analysed. */
  description: string
  analysis: AnalysisId
  roles?: Roles
  params?: Params
  style?: ColumnStyle
  error?: ErrorKind
}

export const SAMPLE_EXPERIMENTS: SampleExperiment[] = [
  // Compare groups
  { file: "drug-response.csv", title: "Xenograft tumor volume", experiment: "In vivo efficacy study", description: "Tumor volume (mm³) and body weight at day 21 in 4 treatment arms, 8 mice each. Scatter dot plot with mean ± SEM, one-way ANOVA with Holm–Šídák comparisons.", analysis: "one_factor", style: "scatter", error: "sem" },
  { file: "replicates.csv", title: "siRNA knockdown viability", experiment: "Cell-based assay (CellTiter-Glo)", description: "Viability as % of scrambled control, 8–10 wells per siRNA, replicates entered in columns. Bar + dots, mean ± SD.", analysis: "column", style: "bar", error: "sd" },
  { file: "paired.csv", title: "Blood pressure over a trial", experiment: "Clinical study, repeated measures", description: "Systolic blood pressure (mmHg) in 14 patients at baseline, week 4 and week 12. Before–after lines and repeated-measures ANOVA.", analysis: "paired", style: "scatter", error: "sd" },
  { file: "two-way.csv", title: "Genotype × treatment glucose", experiment: "Mouse metabolic study", description: "Fasting glucose (mg/dL) in WT and KO mice given vehicle or drug, 6 per group. Grouped bars and two-way ANOVA (does the drug work differently in KO?).", analysis: "two_way", error: "sem" },
  { file: "sex-split.csv", title: "Males vs females by genotype", experiment: "Sex as a biological variable", description: "Body weight (g) of WT, Het and KO mice, 15 males and 15 females each. Split violin and two-way ANOVA (genotype × sex).", analysis: "two_way", params: { chart: "split violin" } },
  { file: "summary.csv", title: "Re-plot a published table", experiment: "Summary data (mean, SD, N)", description: "Lesion volume from a paper: mean, SD and N for sham, stroke and stroke + drug. Bars with SD when raw values aren't available.", analysis: "summary_bars" },
  { file: "western.csv", title: "Western blot densitometry", experiment: "Western blot (ImageJ band intensities)", description: "p-ERK band divided by β-actin loading control, shown as fold of unstimulated control, 4 blots. One-way ANOVA.", analysis: "one_factor", params: { normalize: "fold of control", control: "Control" }, style: "bar", error: "sd" },
  { file: "luciferase.csv", title: "Promoter reporter assay", experiment: "Dual-luciferase reporter", description: "Firefly ÷ Renilla for wild-type and mutant promoter constructs, as fold of empty vector, 4 transfections.", analysis: "one_factor", params: { normalize: "fold of control", control: "Empty vector" }, style: "bar", error: "sd" },
  { file: "single-cell.csv", title: "Gene expression per cluster", experiment: "Single-cell RNA-seq", description: "CD3E expression (log1p) in 6,000 cells across 5 clusters. Violins show the zero-inflated distribution better than bars.", analysis: "one_factor", style: "violin" },

  // XY & curves
  { file: "confluency.csv", title: "Cell proliferation time-lapse", experiment: "Live-cell imaging (IncuCyte)", description: "% confluency of WT and KO cells every 4 h for 72 h, 3 wells each. Replicate columns averaged, mean ± SD.", analysis: "xy", error: "sd" },
  { file: "calcium.csv", title: "Calcium transients", experiment: "Calcium imaging (GCaMP)", description: "Raw fluorescence of 5 ROIs over 60 s, normalized as ΔF/F0 (baseline = first 10%).", analysis: "xy", params: { normalize: "ΔF/F0", fit: "none" } },
  { file: "time-course.csv", title: "Body weight on high-fat diet", experiment: "Longitudinal animal study", description: "Weekly body weight of 6 control and 6 high-fat-diet mice over 5 weeks, one row per mouse per time point. Mean ± SEM per group.", analysis: "time_course", error: "sem" },
  { file: "dose-response.csv", title: "Inhibitor IC50", experiment: "Dose–response (cell viability)", description: "Viability (% of DMSO) for two compounds at 11 concentrations, 0.1 nM–10 µM, in triplicate. 4PL fit gives IC50 and Hill slope.", analysis: "dose_response", error: "sd" },
  { file: "elisa.csv", title: "IL-6 ELISA", experiment: "Sandwich ELISA", description: "8-point standard curve (OD450, duplicates) and 6 serum samples interpolated by 4PL. Sample 6 is above the top standard and gets flagged.", analysis: "standard_curve", params: { fit: "auto" } },
  { file: "kinetics.csv", title: "Enzyme Km and Vmax", experiment: "Enzyme kinetics", description: "Initial velocity at 8 substrate concentrations, in triplicate. Michaelis–Menten fit.", analysis: "kinetics", error: "sd" },
  { file: "pk.csv", title: "Oral drug exposure", experiment: "Pharmacokinetics", description: "Plasma concentration (ng/mL) in 4 subjects over 24 h on a log axis. Non-compartmental Cmax, Tmax, AUC and t½.", analysis: "pk" },
  { file: "bacterial-growth.csv", title: "E. coli growth", experiment: "Microbial growth curve (plate reader)", description: "OD600 of wild type vs ΔrecA every 30 min, triplicates. Max growth rate, doubling time and lag time.", analysis: "growth", error: "sd" },
  { file: "thermal-shift.csv", title: "Ligand stabilization", experiment: "Thermal shift (DSF)", description: "SYPRO Orange fluorescence from 25–95 °C for apo protein and two ligands. Tm and ΔTm show binding.", analysis: "melt" },
  { file: "qpcr-melt.csv", title: "Primer specificity", experiment: "qPCR melt curve", description: "SYBR fluorescence vs temperature for the specific product and a primer-dimer well; derivative peaks give each product's Tm.", analysis: "melt" },
  { file: "amplification.csv", title: "Dilution series Cq", experiment: "qPCR amplification", description: "Baseline-subtracted RFU over 40 cycles for a 10-fold dilution series in duplicate. Log plot, threshold and Cq per well.", analysis: "amplification" },
  { file: "hplc.csv", title: "Protein purity", experiment: "HPLC / FPLC chromatography", description: "UV 280 nm trace of a purified protein prep. Peaks with retention time, area and % area (purity).", analysis: "chromatogram", params: { minHeight: "5" } },

  // Survival & counts
  { file: "survival.csv", title: "Overall survival by arm", experiment: "Clinical trial / survival study", description: "Months to death or censoring for 30 patients per arm. Kaplan–Meier curves with censor ticks, median survival, log-rank test.", analysis: "survival" },
  { file: "contingency.csv", title: "Vaccine protection", experiment: "Challenge study (counts)", description: "Infected vs not infected among 120 vaccinated and 120 placebo animals. % stacked bars and Fisher's exact test.", analysis: "contingency" },
  { file: "cell-types.csv", title: "Tumor immune composition", experiment: "Flow cytometry immunophenotyping", description: "Share of each population among CD45+ cells in one tumor. Donut chart.", analysis: "parts", params: { shape: "donut" } },

  // Distribution & correlation
  { file: "cell-size.csv", title: "Cell size distribution", experiment: "Coulter counter / microscopy", description: "Diameters of 240 cells; frequency histogram with a normal curve and skewness.", analysis: "histogram", params: { bins: "linear" } },
  { file: "flow.csv", title: "CD4 expression histogram", experiment: "Flow cytometry (single parameter)", description: "CD4-PE fluorescence of 8,000 events on log-spaced bins; CD4− and CD4+ peaks separate.", analysis: "histogram", roles: { value: ["CD4-PE"], group: [] }, params: { bins: "log" } },
  { file: "biomarkers.csv", title: "Clinical biomarker correlations", experiment: "Cohort study", description: "Age, BMI, CRP, IL-6 and HbA1c in 40 subjects. Pearson correlation matrix with P values.", analysis: "correlation" },
  { file: "method-compare.csv", title: "Glucometer vs lab analyzer", experiment: "Method comparison", description: "Blood glucose measured both ways in 30 samples. Bland–Altman plot of bias and 95% limits of agreement.", analysis: "bland_altman" },

  // Heatmaps & multivariate
  { file: "expression-matrix.csv", title: "Inflammation gene heatmap", experiment: "RNA-seq / NanoString panel", description: "30 genes in control, LPS and LPS + dexamethasone macrophages (triplicates). Row z-scores with hierarchical clustering.", analysis: "matrix_heatmap", params: { scale: "row z-score", cluster: "rows and columns", top: "50" } },
  { file: "synergy.csv", title: "Drug combination matrix", experiment: "Combination screen (6 × 6 doses)", description: "Viability for drug A × drug B in triplicate. Response heatmap and Bliss excess (synergy is strongest at mid doses).", analysis: "synergy", params: { responseIs: "% viability" } },
  { file: "pca-samples.csv", title: "Patient sample PCA", experiment: "Biomarker panel / transcriptomics", description: "20 genes in 24 samples from healthy, disease A and disease B patients. PCA score plot, scree plot, loadings.", analysis: "pca", params: { orientation: "rows" } },
  { file: "umap.csv", title: "PBMC clusters", experiment: "Single-cell RNA-seq (UMAP)", description: "UMAP coordinates of 2,720 cells colored by annotated cell type.", analysis: "scatter_groups" },
  { file: "flow.csv", title: "FSC vs SSC dot plot", experiment: "Flow cytometry (biaxial)", description: "Forward vs side scatter of 8,000 events: debris, lymphocytes and granulocytes, shaded by density.", analysis: "scatter_groups", roles: { x: ["FSC-A"], y: ["SSC-A"], group: [] } },

  // Lab assays
  { file: "qpcr.csv", title: "Cytokine induction by LPS", experiment: "RT-qPCR (ΔΔCt)", description: "IL6, TNF and CCL2 Ct values in control, LPS and LPS + inhibitor macrophages, 3 biological replicates. GAPDH reference, fold change by 2^−ΔΔCt.", analysis: "qpcr", params: { reference: "GAPDH", control: "Control" } },
  { file: "qpcr-standard.csv", title: "Primer efficiency check", experiment: "qPCR assay validation", description: "10-fold plasmid dilutions (10²–10⁷ copies) in triplicate for 3 primer pairs. Slope, R², efficiency, and unknowns interpolated.", analysis: "qpcr_standard" },
  { file: "zprime.csv", title: "Screening assay quality", experiment: "HTS assay validation", description: "Positive and negative control wells on 4 plates. Z′, signal-to-background and %CV per plate (plate 3 is marginal).", analysis: "zprime", params: { positive: "Positive", negative: "Negative" } },
  { file: "plate.csv", title: "96-well viability plate", experiment: "Plate reader", description: "Luminescence across a 96-well plate with a drug dilution across columns (column 1 = blank). Heatmap plus row/column means reveal edge effects in rows A and H.", analysis: "plate" },
  { file: "volcano.csv", title: "Differential expression", experiment: "RNA-seq (DESeq2)", description: "1,500 genes: log2 fold change vs P. Volcano plot with up/down hits colored and top genes labeled.", analysis: "volcano", params: { fcCutoff: "1", pCutoff: "0.05" } },
  { file: "ma-proteomics.csv", title: "Protein abundance changes", experiment: "Quantitative proteomics (limma)", description: "1,200 proteins: mean log2 intensity vs log2 fold change, significant ones colored. MA plot shows intensity-dependent noise.", analysis: "ma_plot", params: { pCutoff: "0.05" } },

  // Specialized plots
  { file: "waterfall.csv", title: "Tumor response per patient", experiment: "Oncology trial (RECIST)", description: "Best % change in target-lesion size for 40 patients, drug vs placebo, with +20% and −30% lines.", analysis: "waterfall" },
  { file: "forest.csv", title: "Subgroup hazard ratios", experiment: "Clinical trial subgroup analysis", description: "Hazard ratios with 95% CI for overall survival in 10 subgroups, log scale with a line at HR = 1.", analysis: "forest", params: { scale: "ratio (log, ref 1)" } },
  { file: "go-terms.csv", title: "Pathway enrichment", experiment: "GO / pathway enrichment", description: "Top 25 GO terms after LPS stimulation by −log10 P, colored by ontology (BP, MF, CC).", analysis: "ranked_bars", params: { top: "25" } },
]
