// Generates the sample lab datasets in public/samples (seeded, reproducible).
import fs from "node:fs"
import * as XLSX from "xlsx"

let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const norm = (m, sd) => m + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
const r = (v, d = 2) => Number(v.toFixed(d))
const out = (name, rows) => fs.writeFileSync(`public/samples/${name}`, rows.map((row) => row.join(",")).join("\n") + "\n")

// One factor (long)
{
  const rows = [["Treatment", "Tumor volume (mm3)", "Body weight (g)"]]
  for (const [g, m] of [["Vehicle", 820], ["Drug A 10mg", 610], ["Drug A 30mg", 420], ["Drug B 30mg", 560]]) for (let i = 0; i < 8; i++) rows.push([g, r(norm(m, 90), 1), r(norm(22, 1.5))])
  out("drug-response.csv", rows)
}
// Replicates in columns
{
  const rows = [["Scrambled siRNA", "siKRAS #1", "siKRAS #2"]]
  for (let i = 0; i < 10; i++) rows.push([r(norm(100, 8), 1), r(norm(72, 10), 1), i > 7 ? "" : r(norm(65, 9), 1)])
  out("replicates.csv", rows)
}
// Paired / repeated measures
{
  const rows = [["Patient", "Baseline", "Week 4", "Week 12"]]
  for (let i = 1; i <= 14; i++) { const b = norm(150, 15); rows.push([`P${String(i).padStart(2, "0")}`, r(b, 0), r(b - norm(8, 6), 0), r(b - norm(18, 8), 0)]) }
  out("paired.csv", rows)
}
// Two-way
{
  const rows = [["Genotype", "Treatment", "Glucose (mg/dL)"]]
  const m = { "WT|Vehicle": 110, "WT|Drug": 100, "KO|Vehicle": 180, "KO|Drug": 125 }
  for (const g of ["WT", "KO"]) for (const t of ["Vehicle", "Drug"]) for (let i = 0; i < 6; i++) rows.push([g, t, r(norm(m[`${g}|${t}`], 12), 0)])
  out("two-way.csv", rows)
}
// Summary data
out("summary.csv", [["Group", "Mean lesion volume (mm³)", "SD", "N"], ["Sham", 12.4, 2.1, 8], ["Stroke", 28.9, 5.6, 8], ["Stroke + drug", 18.2, 4.3, 9]])
// Live-cell imaging confluency, replicate wells in columns
{
  const rows = [["Time (h)", "WT_1", "WT_2", "WT_3", "KO_1", "KO_2", "KO_3"]]
  for (let t = 0; t <= 72; t += 4) {
    const L = (k, K) => 8 + (K - 8) / (1 + Math.exp(-k * (t - 30)))
    rows.push([t, ...[0, 1, 2].map(() => r(Math.min(100, L(0.12, 96) + norm(0, 2)), 1)), ...[0, 1, 2].map(() => r(Math.min(100, L(0.08, 70) + norm(0, 2)), 1))])
  }
  out("confluency.csv", rows)
}
// Time course, long format
{
  const rows = [["Group", "Mouse", "Day", "Body weight (g)"]]
  for (const [g, slope] of [["Control", 0.35], ["High-fat diet", 0.8]]) for (let m = 1; m <= 6; m++) { const b = norm(20, 1); for (const d of [0, 7, 14, 21, 28, 35]) rows.push([g, `${g[0]}${m}`, d, r(b + slope * (d / 7) * 1.5 + norm(0, 0.6), 1)]) }
  out("time-course.csv", rows)
}
// Dose-response (inhibition), replicates in columns
{
  const conc = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000]
  const rows = [["Concentration (nM)", "Compound A_1", "Compound A_2", "Compound A_3", "Compound B_1", "Compound B_2", "Compound B_3"]]
  const f = (x, ic50, h) => 2 + 98 / (1 + (x / ic50) ** h)
  for (const c of conc) rows.push([c, ...[0, 1, 2].map(() => r(f(c, 45, 1.1) + norm(0, 3), 1)), ...[0, 1, 2].map(() => r(f(c, 900, 0.9) + norm(0, 3), 1))])
  out("dose-response.csv", rows)
}
// ELISA standard curve + unknowns
{
  const rows = [["Sample", "Concentration (pg/mL)", "OD450_1", "OD450_2"]]
  const od = (c) => 0.06 + (2.9 - 0.06) / (1 + (210 / Math.max(c, 0.01)) ** 1.15)
  const stds = [1000, 500, 250, 125, 62.5, 31.25, 15.6, 0]
  stds.forEach((c, i) => rows.push([`Std ${i + 1}`, c, r(od(c) + norm(0, 0.02), 3), r(od(c) + norm(0, 0.02), 3)]))
  for (const [i, c] of [[1, 80], [2, 340], [3, 22], [4, 610], [5, 150], [6, 1500]]) rows.push([`Sample ${i}`, "", r(od(c) + norm(0, 0.02), 3), r(od(c) + norm(0, 0.02), 3)])
  out("elisa.csv", rows)
}
// Michaelis-Menten
{
  const rows = [["Substrate (µM)", "Velocity rep1", "Velocity rep2", "Velocity rep3"]]
  for (const s of [1, 2.5, 5, 10, 20, 40, 80, 160]) rows.push([s, ...[0, 1, 2].map(() => r((120 * s) / (15 + s) + norm(0, 3), 1))])
  out("kinetics.csv", rows)
}
// Survival
{
  const rows = [["Patient", "Arm", "Months", "Status"]]
  let id = 1
  for (const [arm, median] of [["Standard", 10], ["New therapy", 28]]) for (let i = 0; i < 30; i++) {
    const t = -Math.log(rnd()) * (median / Math.LN2)
    const c = 30 + rnd() * 30
    rows.push([`S${id++}`, arm, r(Math.min(t, c), 1), t <= c ? 1 : 0])
  }
  out("survival.csv", rows)
}
// Contingency (one row per subject)
{
  const rows = [["Group", "Outcome"]]
  for (let i = 0; i < 120; i++) rows.push(["Vaccine", rnd() < 0.12 ? "Infected" : "Not infected"])
  for (let i = 0; i < 120; i++) rows.push(["Placebo", rnd() < 0.31 ? "Infected" : "Not infected"])
  out("contingency.csv", rows)
}
// Parts of whole
out("cell-types.csv", [["Cell type", "Percent of CD45+"], ["T cells", 42.5], ["B cells", 18.2], ["NK cells", 9.6], ["Monocytes", 21.4], ["Dendritic cells", 3.1], ["Other", 5.2]])
// Histogram
{
  const rows = [["Cell diameter (µm)"]]
  for (let i = 0; i < 240; i++) rows.push([r(Math.exp(norm(Math.log(12), 0.18)), 2)])
  out("cell-size.csv", rows)
}
// Correlation
{
  const rows = [["Subject", "Age", "BMI", "CRP (mg/L)", "IL-6 (pg/mL)", "HbA1c (%)"]]
  for (let i = 1; i <= 40; i++) {
    const age = norm(52, 12), bmi = norm(27, 4) + (age - 52) * 0.05
    const crp = Math.max(0.2, 0.4 * (bmi - 20) + norm(0, 1.5)), il6 = Math.max(0.5, 1.2 * crp + norm(0, 2)), a1c = 5 + 0.04 * (bmi - 20) + 0.01 * (age - 40) + norm(0, 0.35)
    rows.push([`ID${i}`, r(age, 0), r(bmi, 1), r(crp, 2), r(il6, 1), r(a1c, 1)])
  }
  out("biomarkers.csv", rows)
}
// Method comparison
{
  const rows = [["Sample", "Method A (glucometer)", "Method B (lab analyzer)"]]
  for (let i = 1; i <= 30; i++) { const t = 60 + rnd() * 240; rows.push([`G${i}`, r(t * 1.04 + 3 + norm(0, 8), 0), r(t + norm(0, 4), 0)]) }
  out("method-compare.csv", rows)
}
// qPCR
{
  const rows = [["Sample", "Gene", "Biological replicate", "Ct"]]
  const base = { GAPDH: 18, IL6: 28, TNF: 26.5, CCL2: 27 }
  const shift = { Control: { IL6: 0, TNF: 0, CCL2: 0 }, LPS: { IL6: -4.2, TNF: -2.6, CCL2: -3.1 }, "LPS + inhibitor": { IL6: -1.5, TNF: -0.9, CCL2: -1.2 } }
  for (const s of Object.keys(shift)) for (let b = 1; b <= 3; b++) { const load = norm(0, 0.3); for (const g of Object.keys(base)) rows.push([s, g, b, r(base[g] + load + (shift[s][g] ?? 0) + norm(0, 0.25), 2)]) }
  out("qpcr.csv", rows)
}
// 96-well plate (viability, edge effect + a dilution across columns)
{
  const rows = [["", ...Array.from({ length: 12 }, (_, i) => i + 1)]]
  for (const [ri, L] of [..."ABCDEFGH"].entries()) rows.push([L, ...Array.from({ length: 12 }, (_, c) => r((c === 0 ? 0.08 : 1.6 / (1 + 2 ** (c - 6))) + 0.1 + (ri === 0 || ri === 7 ? -0.12 : 0) + norm(0, 0.03), 3))])
  out("plate.csv", rows)
}
// Volcano
{
  const rows = [["Gene", "baseMean", "log2FoldChange", "pvalue", "padj"]]
  const n = 1500
  const ps = []
  for (let i = 0; i < n; i++) {
    const hit = rnd() < 0.06
    const fc = hit ? norm(0, 1) + (rnd() < 0.5 ? -2.2 : 2.2) : norm(0, 0.45)
    const z = Math.abs(fc) / (hit ? 0.35 : 0.5) + norm(0, 0.6)
    const p = Math.min(1, Math.max(1e-30, 2 * Math.exp(-0.717 * Math.abs(z) - 0.416 * z * z)))
    ps.push([`GENE${i + 1}`, r(fc, 3), p, r(Math.exp(norm(Math.log(400), 1.6)), 1)])
  }
  const sorted = [...ps].sort((a, b) => a[2] - b[2])
  const adj = new Map(sorted.map((row, k) => [row[0], Math.min(1, (row[2] * n) / (k + 1))]))
  for (const row of ps) rows.push([row[0], row[3], row[1], row[2].toExponential(3), adj.get(row[0]).toExponential(3)])
  out("volcano.csv", rows)
}

// Western blot densitometry with loading control
{
  const rows = [["Treatment", "p-ERK band", "β-actin band"]]
  for (const [g, m] of [["Control", 1], ["EGF 5 min", 3.2], ["EGF 15 min", 2.1], ["EGF + inhibitor", 1.2]]) for (let i = 0; i < 4; i++) { const load = norm(1, 0.15); rows.push([g, r(m * load * norm(10000, 900), 0), r(load * 25000, 0)]) }
  out("western.csv", rows)
}
// Dual luciferase
{
  const rows = [["Construct", "Firefly", "Renilla"]]
  for (const [g, m] of [["Empty vector", 1], ["Promoter WT", 8], ["Promoter mut1", 3], ["Promoter mut2", 0.9]]) for (let i = 0; i < 4; i++) { const tx = norm(1, 0.2); rows.push([g, r(m * tx * norm(5000, 400), 0), r(tx * norm(20000, 1200), 0)]) }
  out("luciferase.csv", rows)
}
// Pharmacokinetics (one-compartment oral)
{
  const ts = [0.25, 0.5, 1, 2, 4, 6, 8, 12, 24]
  const rows = [["Time (h)", ...[1, 2, 3, 4].map((k) => `Subject ${k} (ng/mL)`)]]
  const subj = [1, 2, 3, 4].map(() => ({ ka: norm(1.4, 0.2), ke: norm(0.17, 0.02), A: norm(520, 50) }))
  for (const t of ts) rows.push([t, ...subj.map((p) => r(Math.max(0.5, p.A * (Math.exp(-p.ke * t) - Math.exp(-p.ka * t)) * (1 + norm(0, 0.05))), 1))])
  out("pk.csv", rows)
}
// Bacterial growth OD600
{
  const rows = [["Time (h)", "WT OD600_1", "WT OD600_2", "WT OD600_3", "ΔrecA OD600_1", "ΔrecA OD600_2", "ΔrecA OD600_3"]]
  const gomp = (t, A, mu, lag) => 0.02 * Math.exp(A * Math.exp(-Math.exp((mu * Math.E) / A * (lag - t) + 1)))
  for (let t = 0; t <= 16; t += 0.5) rows.push([t, ...[0, 1, 2].map(() => r(gomp(t, 4.4, 0.85, 1.5) * (1 + norm(0, 0.03)), 3)), ...[0, 1, 2].map(() => r(gomp(t, 4.0, 0.55, 2.5) * (1 + norm(0, 0.03)), 3))])
  out("bacterial-growth.csv", rows)
}
// Thermal shift (DSF): sigmoid unfolding then aggregation decline
{
  const rows = [["Temperature (°C)", "Apo", "+ Ligand A", "+ Ligand B"]]
  const f = (T, tm) => 1000 + 9000 / (1 + Math.exp((tm - T) / 1.6)) - (T > tm + 6 ? Math.min(5500, (T - tm - 6) * 350) : 0)
  for (let T = 25; T <= 95; T += 0.5) rows.push([T, r(f(T, 52.3) + norm(0, 60), 0), r(f(T, 56.1) + norm(0, 60), 0), r(f(T, 61.8) + norm(0, 60), 0)])
  out("thermal-shift.csv", rows)
}
// qPCR amplification curves (10-fold dilutions, duplicates)
{
  const wells = ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6"]
  const cqs = [15, 15.1, 18.3, 18.4, 21.6, 21.7, 25, 24.9, 28.3, 28.5, 31.6, 31.8]
  const rows = [["Cycle", ...wells]]
  for (let c = 1; c <= 40; c++) rows.push([c, ...cqs.map((cq) => r(120 + 0.8 * c + 9000 / (1 + Math.exp(-(c - (cq + 4.2)) / 1.3)) + norm(0, 6), 1))])
  out("amplification.csv", rows)
}
// Calcium imaging traces
{
  const rois = ["ROI A", "ROI B", "ROI C", "ROI D", "ROI E"]
  const rows = [["Time (s)", ...rois]]
  const base = rois.map(() => norm(400, 60))
  const spikes = rois.map(() => [8 + rnd() * 6, 20 + rnd() * 10, 38 + rnd() * 8])
  for (let t = 0; t <= 60; t += 0.25) rows.push([t, ...rois.map((_, k) => r(base[k] * (1 + spikes[k].reduce((s, t0) => s + (t >= t0 ? 0.9 * Math.exp(-(t - t0) / 2.5) : 0), 0)) + norm(0, 6), 1))])
  out("calcium.csv", rows)
}
// HPLC chromatogram
{
  const rows = [["Retention time (min)", "UV 280 nm (mAU)"]]
  const pk = [[3.2, 420, 0.12], [5.8, 1250, 0.18], [6.6, 300, 0.15], [11.4, 760, 0.25]]
  for (let t = 0; t <= 15; t += 0.025) rows.push([r(t, 3), r(2 + 0.3 * t + pk.reduce((s, [c, h, w]) => s + h * Math.exp(-0.5 * ((t - c) / w) ** 2), 0) + norm(0, 1.2), 2)])
  out("hplc.csv", rows)
}
// qPCR standard curves (3 primer pairs) + unknowns
{
  const rows = [["Primer", "Quantity (copies)", "Ct_1", "Ct_2", "Ct_3"]]
  for (const [p, eff, b] of [["GAPDH", 0.98, 36.2], ["IL6", 0.93, 37.5], ["MYC", 0.82, 38.9]]) {
    const slope = -1 / Math.log10(1 + eff)
    for (const q of [1e7, 1e6, 1e5, 1e4, 1e3, 1e2]) rows.push([p, q, ...[0, 1, 2].map(() => r(b + slope * Math.log10(q) + norm(0, 0.12), 2))])
    for (const q of [3e5, 2e3]) rows.push([p, "", ...[0, 1, 2].map(() => r(b + slope * Math.log10(q) + norm(0, 0.12), 2))])
  }
  out("qpcr-standard.csv", rows)
}
// Assay quality controls per plate
{
  const rows = [["Plate", "Well type", "Signal"]]
  for (const [pl, sdp, sdn] of [["Plate 1", 900, 300], ["Plate 2", 1100, 350], ["Plate 3", 2600, 900], ["Plate 4", 950, 320]]) {
    for (let i = 0; i < 16; i++) rows.push([pl, "Positive", r(norm(24000, sdp), 0)])
    for (let i = 0; i < 16; i++) rows.push([pl, "Negative", r(norm(3000, sdn), 0)])
    for (let i = 0; i < 8; i++) rows.push([pl, "Sample", r(norm(12000, 5000), 0)])
  }
  out("zprime.csv", rows)
}
// Gene expression matrix (genes × samples)
{
  const samples = ["Ctrl_1", "Ctrl_2", "Ctrl_3", "LPS_1", "LPS_2", "LPS_3", "LPS+Dex_1", "LPS+Dex_2", "LPS+Dex_3"]
  const rows = [["Gene", ...samples]]
  const genes = ["IL6", "TNF", "IL1B", "CXCL10", "CCL2", "NFKBIA", "PTGS2", "IL10", "SOCS3", "IRF7", "ISG15", "MX1", "TSC22D3", "PER1", "FKBP5", "DUSP1", "ACTB", "GAPDH", "RPLP0", "B2M", "HIF1A", "VEGFA", "SLC2A1", "LDHA", "PDK1", "MKI67", "CCNB1", "TOP2A", "CDK1", "E2F1"]
  genes.forEach((g, gi) => {
    const pattern = gi < 9 ? [0, 3.5, 1.5] : gi < 12 ? [0, 2.8, 2.6] : gi < 16 ? [0, 0.2, 2.4] : gi < 20 ? [0, 0, 0] : gi < 25 ? [0, 1.2, 0.6] : [0, -1.4, -1.6]
    const b = norm(7, 1.5)
    rows.push([g, ...samples.map((_, si) => r(2 ** (b + pattern[Math.floor(si / 3)] + norm(0, 0.25)), 1))])
  })
  out("expression-matrix.csv", rows)
}
// Drug combination (viability) with synergy at mid doses
{
  const A = [0, 0.1, 0.3, 1, 3, 10]
  const B = [0, 1, 3, 10, 30, 100]
  const rows = [["Drug A (µM)", "Drug B (nM)", "Viability (%)"]]
  const ia = (a) => a / (a + 1.5)
  const ib = (b) => b / (b + 20)
  for (const a of A) for (const b of B) for (let k = 0; k < 3; k++) {
    const bliss = ia(a) + ib(b) - ia(a) * ib(b)
    const syn = a > 0 && b > 0 ? 0.18 * Math.exp(-((Math.log10(a) - Math.log10(1)) ** 2 + (Math.log10(b) - Math.log10(10)) ** 2)) : 0
    rows.push([a, b, r(100 * (1 - Math.min(0.99, bliss + syn)) + norm(0, 2.5), 1)])
  }
  out("synergy.csv", rows)
}
// PCA: samples × genes
{
  const genes = Array.from({ length: 20 }, (_, i) => `Gene${i + 1}`)
  const rows = [["Sample", "Group", ...genes]]
  const shift = { Healthy: genes.map(() => 0), "Disease A": genes.map((_, i) => (i < 8 ? 1.6 : 0)), "Disease B": genes.map((_, i) => (i >= 6 && i < 14 ? -1.4 : i >= 16 ? 1.2 : 0)) }
  let n = 1
  for (const g of Object.keys(shift)) for (let k = 0; k < 8; k++) rows.push([`S${n++}`, g, ...genes.map((_, i) => r(5 + shift[g][i] + norm(0, 0.5), 2))])
  out("pca-samples.csv", rows)
}
// UMAP clusters
{
  const rows = [["Cell", "UMAP_1", "UMAP_2", "Cluster"]]
  const cl = [["T cells", -6, 4, 900], ["B cells", 5, 6, 500], ["NK cells", -4, -3, 350], ["Monocytes", 6, -4, 700], ["DC", 1, -8, 150], ["Platelets", 9, 9, 120]]
  let n = 1
  for (const [name, cx, cy, k] of cl) for (let i = 0; i < k; i++) rows.push([`c${n++}`, r(cx + norm(0, 1.2), 3), r(cy + norm(0, 1.2), 3), name])
  out("umap.csv", rows)
}
// Flow cytometry events
{
  const rows = [["FSC-A", "SSC-A", "CD4-PE"]]
  for (let i = 0; i < 8000; i++) {
    const kind = rnd()
    if (kind < 0.12) rows.push([r(Math.max(1000, norm(18000, 6000)), 0), r(Math.max(500, norm(9000, 4000)), 0), r(Math.exp(norm(Math.log(150), 0.6)), 1)])
    else if (kind < 0.7) { const pos = rnd() < 0.45; rows.push([r(norm(62000, 7000), 0), r(norm(22000, 4000), 0), r(Math.exp(norm(Math.log(pos ? 9000 : 220), 0.45)), 1)]) }
    else rows.push([r(norm(98000, 9000), 0), r(norm(78000, 11000), 0), r(Math.exp(norm(Math.log(900), 0.5)), 1)])
  }
  out("flow.csv", rows)
}
// Single-cell expression per cluster (zero-inflated)
{
  const rows = [["Cluster", "CD3E expression (log1p)"]]
  for (const [c, n, p0, m] of [["T cells", 1800, 0.15, 2.4], ["B cells", 1200, 0.92, 0.6], ["NK cells", 900, 0.55, 1.2], ["Monocytes", 1500, 0.95, 0.4], ["DC", 600, 0.9, 0.5]]) for (let i = 0; i < n; i++) rows.push([c, rnd() < p0 ? 0 : r(Math.max(0.05, norm(m, 0.5)), 3)])
  out("single-cell.csv", rows)
}
// Split violin: sex within genotype
{
  const rows = [["Genotype", "Sex", "Body weight (g)"]]
  for (const [g, m] of [["WT", 0], ["Het", 1.5], ["KO", 4]]) for (const [sx, d] of [["Male", 4], ["Female", 0]]) for (let i = 0; i < 15; i++) rows.push([g, sx, r(22 + m + d + norm(0, 1.8 + (g === "KO" && sx === "Male" ? 1.5 : 0)), 1)])
  out("sex-split.csv", rows)
}
// Waterfall
{
  const rows = [["Patient", "Arm", "Best % change from baseline"]]
  for (let i = 1; i <= 40; i++) { const arm = i % 2 ? "Drug" : "Placebo"; rows.push([`P${String(i).padStart(2, "0")}`, arm, r(Math.max(-100, Math.min(120, norm(arm === "Drug" ? -28 : 12, 30))), 1)]) }
  out("waterfall.csv", rows)
}
// Forest plot
out("forest.csv", [["Subgroup", "HR", "Lower 95% CI", "Upper 95% CI"], ["Overall", 0.72, 0.61, 0.85], ["Age < 65", 0.68, 0.54, 0.86], ["Age ≥ 65", 0.79, 0.61, 1.02], ["Male", 0.7, 0.56, 0.88], ["Female", 0.75, 0.57, 0.99], ["ECOG 0", 0.64, 0.5, 0.82], ["ECOG 1", 0.84, 0.66, 1.07], ["PD-L1 ≥ 1%", 0.58, 0.45, 0.75], ["PD-L1 < 1%", 0.95, 0.73, 1.24], ["Prior therapy", 0.81, 0.62, 1.06]])
// GO enrichment
{
  const terms = ["inflammatory response", "response to lipopolysaccharide", "cytokine-mediated signaling pathway", "regulation of IL-6 production", "neutrophil chemotaxis", "type I interferon signaling", "response to virus", "positive regulation of NF-kB signaling", "leukocyte migration", "chemokine activity", "cytokine activity", "receptor ligand activity", "extracellular space", "external side of plasma membrane", "regulation of apoptotic process", "angiogenesis", "response to hypoxia", "glycolytic process", "cell chemotaxis", "T cell activation", "antigen processing and presentation", "MHC class II protein complex", "negative regulation of viral genome replication", "defense response to bacterium", "fever generation"]
  const ont = (t) => (/activity/.test(t) ? "MF" : /space|membrane|complex/.test(t) ? "CC" : "BP")
  const rows = [["Term", "-log10 P", "Gene count", "Ontology"]]
  terms.forEach((t, i) => rows.push([t, r(Math.max(1.3, 14 - i * 0.45 + norm(0, 0.6)), 2), Math.round(Math.max(3, 40 - i + norm(0, 4))), ont(t)]))
  out("go-terms.csv", rows)
}

// qPCR melt curve (fluorescence falls as DNA melts)
{
  const rows = [["Temperature (°C)", "Specific product", "Primer dimer"]]
  const f = (T, tm, h) => 300 + h / (1 + Math.exp((T - tm) / 0.7)) + (95 - T) * 12
  for (let T = 65; T <= 95; T += 0.25) rows.push([T, r(f(T, 84.2, 9000) + norm(0, 25), 0), r(f(T, 76.5, 2500) + norm(0, 25), 0)])
  out("qpcr-melt.csv", rows)
}
// Proteomics differential abundance (limma), for an MA plot
{
  const rows = [["Protein", "AveExpr", "logFC", "adj.P.Val"]]
  for (let i = 1; i <= 1200; i++) {
    const a = norm(24, 2.2)
    const hit = rnd() < 0.07
    const fc = hit ? (rnd() < 0.5 ? -1 : 1) * (1 + Math.abs(norm(0.6, 0.5))) : norm(0, 0.35 + Math.max(0, 22 - a) * 0.08)
    const p = hit ? Math.exp(norm(Math.log(0.004), 1.2)) : Math.min(1, Math.exp(norm(Math.log(0.4), 0.8)))
    rows.push([`P${String(i).padStart(5, "0")}`, r(a, 2), r(fc, 3), Number(p.toPrecision(3))])
  }
  out("ma-proteomics.csv", rows)
}
// Multi-sheet workbook
{
  const wb = XLSX.utils.book_new()
  for (const [sheet, f] of [["Treatments", "drug-response.csv"], ["qPCR", "qpcr.csv"], ["Survival", "survival.csv"]]) {
    const aoa = fs.readFileSync(`public/samples/${f}`, "utf8").trim().split("\n").map((l) => l.split(",").map((v) => (v === "" ? null : isNaN(+v) ? v : +v)))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  }
  fs.writeFileSync("public/samples/example-workbook.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))
}
console.log("samples written:", fs.readdirSync("public/samples").length)
