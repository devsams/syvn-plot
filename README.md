# Syvn Plot

Lab data in, publication-ready graphs and statistics out. Drop a CSV or Excel file (or pick a sample experiment) and get Prism-style graphs and statistics right away. Everything runs in the browser and makes no AI calls.

    npm install
    npm run dev -- --port 5180

## Analyses (34, auto-detected; switch analysis or reassign columns in the panel)

| Group | Analyses |
|---|---|
| Compare groups | Column (replicates in columns), one factor (with ÷ loading control / Renilla and % or fold of control), paired / before–after, two factors (two-way ANOVA; grouped bars or split violin), summary data (mean/SD/N) |
| XY & curves | XY (replicate averaging, ΔF/F0 / % max / fold-of-first, linear or initial-rate fit), long time course, dose–response (4PL EC50/IC50), standard curve + unknowns, Michaelis–Menten, pharmacokinetics (Cmax, Tmax, AUC, t½), growth curves (µmax, doubling, lag), melt / thermal shift (Tm), qPCR amplification (Cq), chromatogram peaks |
| Survival & counts | Kaplan–Meier + log-rank, contingency (chi-square, Fisher, % bars, count heatmap), parts of whole |
| Distribution & correlation | Histogram (linear or log bins), correlation (Pearson/Spearman, matrix), Bland–Altman |
| Heatmaps & multivariate | Matrix heatmap (z-score/log2, hierarchical clustering, top-variance rows), Bliss synergy, PCA (samples in rows or columns), scatter colored by group (UMAP/t-SNE/flow, density shading for big data) |
| Lab assays | qPCR ΔΔCt, qPCR standard curve + primer efficiency, Z′ / S/B / %CV per plate, plate map, volcano, MA plot |
| Specialized plots | Waterfall, forest plot, ranked horizontal bars (GO terms) |

**Pick a test from a dropdown:** the Analysis picker sits above the graph, and the live controls on the graph include **Test** and **Multiple comparisons**. Change either and the graph, statistics, tables and legend/methods text update straight away, with no AI needed. With a key, the AI sets the same options ("use Mann–Whitney", "Tukey instead"), validated the same way.

**Search** (header, ⌘K / Ctrl+K or /) finds analyses, tests, graph types, sample experiments and features ("u test", "ic50", "violin", "export pdf", "log scale"). Picking a result applies it to your data, or opens a matching sample experiment when no file is loaded.

Every graph has a toolbar:
- **Labels**: title and axis names.
- **Colors**: 26 palette themes (colorblind-safe Okabe–Ito / Tol, grayscale, Nature, Science, Lancet, NEJM, JAMA, Cell, Viridis, …); recolor any group, series or bar from a 122-swatch grid or a custom hex; 16 heatmap color scales.
- **Text**: click any text on the graph to change or hide it; add your own labels and drag them into place.
- **Full screen**: large view with a live preview of each export shape.
- **Download**: journal single (85 mm), 1.5 (114 mm) and double column (174 mm), square, portrait, 16:9 slide (1920 × 1080) and A4 landscape. Formats: vector PDF (Arimo font embedded, so µ Δ ≥ ′ print correctly), SVG, and PNG at 150/300/600 dpi with the DPI stored in the file. Each size re-lays out the graph instead of stretching it.
- X/Y axis scale (auto, linear, log) in the analysis panel. Column graphs cap dots at 400 per group, and XY clouds over 2,500 points switch to density shading, so 10k-cell datasets stay fast.

Statistics: Welch, Student and paired t tests; one-way, Welch, repeated-measures and two-way (type III) ANOVA; non-parametric Mann–Whitney, Wilcoxon signed-rank, Kruskal–Wallis and Friedman tests; multiple comparisons by Holm–Šídák, Tukey HSD, Bonferroni, Dunnett (vs control), Games–Howell (after Welch ANOVA) and Dunn's (after Kruskal–Wallis); Shapiro–Wilk normality and Grubbs' outlier checks on every group comparison; log-rank, chi-square, Fisher's exact, Pearson and Spearman, 4PL, Michaelis–Menten and linear fits, PCA (Jacobi eigen-decomposition), average-linkage clustering and non-compartmental PK. **Sample experiments:** 42 ready-made experiments (`src/lib/samples.ts`, data in `public/samples/`), at least one per analysis, each named by experiment type (xenograft study, sandwich ELISA, DSF thermal shift, RT-qPCR, HTS validation…) and opening with the graph style and options that suit it best. `node scripts/make-samples.mjs` regenerates the data.

## How it works

1. `src/lib/parse.ts`: reads CSV/TSV/XLSX and labels each column as number, category, date or text. It also recognizes plate-reader grids.
2. `src/lib/helpers.ts`, `src/lib/analyses.ts`, `src/lib/analyses-extra.ts`: detection and runners. `src/lib/analysis-defs.ts`: the analysis catalog (roles, options). The UI and the AI prompt both use it.
3. `src/lib/analyses.ts`: detection scoring and a runner for each analysis. Each runner returns chart and table specs.
4. `src/lib/agent.ts`: turns specs into A2UI v0.9 messages. `src/a2ui/catalog.tsx` adds the custom components (Chart, StatsTable, ChartGrid) to the A2UI basic catalog.
5. `src/charts/`: SVG renderers (column, XY/curves/survival/histogram, grouped/stacked bars, heatmap, pie), exportable as SVG or PNG.

## Graph state: `graphSpec` in one A2UI surface

Each graph lives in one long-lived A2UI v0.9 surface, `research-graph`. Its locked catalog has only Column, Row, Text, Card, Chart, ChartGrid, StatsTable, ChartTypeControl, ScaleControl, FilterControl and ExportButton. The canonical state is `/graphSpec` in the data model:

`analysis, chartType, xColumn, yColumns, groupBy, xScale, yScale, title, xLabel, yLabel, filters, annotations, palette, errorBars`, plus `roles` / `params` (exact per-analysis column roles, kept in sync with x/y/group) and `chartEdits` (per-chart colors and text edits).

The setup panel, the live controls, the Labels/Colors/Text tools and the AI chat all change the graph by patching `graphSpec`. After the first `createSurface`, only changed parts are sent, as `updateComponents` / `updateDataModel` messages, so the view is never rebuilt. The setup panel's "Show A2UI messages" button shows the message log. Code: `src/lib/graphSpec.ts` and `src/research/`.

## Free vs. with your own AI key

**Free, no key, nothing leaves the browser:** every analysis, graph, statistic, control, color, text edit and export. Each graph also gets a **figure legend and statistical-methods paragraph** (`src/lib/figureText.ts`), written from the graph settings and the computed statistics, ready to copy.

**With your own key** (API key button: Gemini, OpenAI or Anthropic Claude), the optional AI assistant adds:

| Action | What it does | Guardrail |
|---|---|---|
| Edit by asking | "log scale, drop Vehicle, violin plot" | A2UI patches validated against the CSV; Undo |
| 🧭 Which test should I use? | Recommends an analysis and explains why; asks up to two questions if the design is unclear | Only Syvn Plot's analyses; nothing changes until you click "Apply recommendation" |
| 🧹 Clean up my data | Proposes steps (merge group spellings, units → numbers, drop summary rows, fill merged cells, wide → long, …) | Asks before sending a data sample; local preview; "Apply cleanup" and Undo |
| 📝 Summarize results | A results paragraph | Uses only numbers the app computed; each number is checked (`src/lib/summaryCheck.ts`) |
| ✨ Polish legend | Rewrites the legend and methods for a journal | Numbers checked against the original; "Use this text" or back to the generated text |

The AI never computes statistics and is only called when you click. Server: `server/tasks.ts` (prompts and schemas per task), `server/routes.ts`. The shared-key free tier is **off** unless `FREE_DAILY_LIMIT` > 0 and a server key is set.

## AI chat (bring your own key)

- Click **API key** and pick Google Gemini, OpenAI or Anthropic Claude, then paste your key. **Check key** lists the provider's models, which costs nothing. The key stays in this browser (localStorage, or sessionStorage if "remember" is off). It's sent as a header with each AI request, forwarded to the provider, and never stored or logged by the server.
- With your own key, AI use is unlimited. Optionally, the server's key (`GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env.local`) can give `FREE_DAILY_LIMIT` requests per browser per day. The default is 0, so it's off.
- Default models (the cheap tier of each provider): `gemini-3.5-flash-lite`, `gpt-4.1-mini`, `claude-haiku-5-5`. Claude uses the official `@anthropic-ai/sdk` with structured output and low effort (medium for the test advisor). The server-side refusal fallback is only sent for models that support it, which Haiku doesn't. The model can be changed in the modal.
- Each chat turn sends the current `graphSpec`, column metadata (names, types, ranges, group values, 5 example rows) and the component list. The agent replies with A2UI `updateDataModel` (and rarely `updateComponents`) patches.
- **Strict validation** (`src/lib/a2uiValidate.ts`). Every incoming message is checked before anything renders: message shape, surface id, allowed operations (no create/delete surface), allowed paths (`/graphSpec` only), locked component types, existing component ids, and every column, filter value, chart type and scale against the CSV. Problems appear as plain-language messages ("There's no column called “Dose”… Columns in this file: …") and nothing is applied. Invalid keys, missing keys and free-tier limits get their own messages and a button to open key settings. Each applied turn has **Undo**.
- Server: `server/routes.ts` (`/api/chat`, `/api/verify-key`, `/api/ai-status`), `server/agent.ts` (prompt, reply schema, conversion to A2UI), `server/providers/*`.
