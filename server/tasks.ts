/**
 * The AI tasks BenchPlot offers with a personal key. Each task has its own
 * instructions and a strict output schema. The AI never computes statistics:
 * it edits settings, recommends analyses, proposes cleanup steps for approval,
 * or writes text from numbers the app already computed.
 */
import { catalogText } from "../src/lib/analysis-defs"
import { APP_RULES, SYSTEM_PROMPT as EDIT_PROMPT, type ChatTurn } from "./agent"

export type TaskId = "edit" | "advise" | "summarize" | "polish" | "cleanup"
export type SchemaId = "patch" | "text" | "cleanup"
export const TASK_SCHEMA: Record<TaskId, SchemaId> = { edit: "patch", advise: "patch", summarize: "text", polish: "text", cleanup: "cleanup" }

export type TaskRequest = {
  task: TaskId
  question: string
  graphSpec?: unknown
  dataset?: unknown
  chartTypes?: string[]
  components?: { id: string; component: string }[]
  history?: ChatTurn[]
  stats?: unknown
  figureText?: { legend: string; methods: string }
  sample?: unknown
}

/** effort: how much the model may think (Claude) — low keeps simple tasks cheap; the test advisor gets a bit more. */
export type Prompt = { system: string; user: string; history: ChatTurn[]; effort: "low" | "medium" }

const ADVISE_PROMPT = `You are a friendly biostatistics advisor inside BenchPlot, a GraphPad-Prism-like app for lab researchers.
Recommend the most appropriate analysis for the researcher's data, chosen ONLY from BenchPlot's analyses:
${catalogText()}

${APP_RULES}

How to advise:
- Base it on the data's structure (column types, group columns, repeated/paired measurements, number of groups, continuous vs categorical outcome, time-to-event, dose series) and on what the researcher says.
- If a key fact is unknown and changes the answer (e.g. are the same animals measured at each time point? are groups independent?), ask at most two short questions in "reply" and return no patches.
- Otherwise explain your recommendation in 3–6 plain sentences: which analysis and test, why it fits, and one assumption to keep in mind (e.g. small n, normality, independence). Group comparisons offer params "test" (Welch t / ANOVA, Student t / ANOVA, Welch t / Welch ANOVA, Mann–Whitney / Kruskal–Wallis) and "posthoc" (Holm–Šídák, Tukey, Bonferroni, Dunnett (vs control), None); paired data offers "test" (Paired t / RM ANOVA, Wilcoxon / Friedman). Set them with "/graphSpec/params/test" or "/graphSpec/params/posthoc". Mention honestly if a better method exists that BenchPlot doesn't offer (e.g. mixed models).
- Return patches that switch the graph to your recommendation: "updateDataModel" on "/graphSpec/analysis" and, if needed, "/graphSpec/xColumn", "/graphSpec/yColumns", "/graphSpec/groupBy", "/graphSpec/chartType" (valueJson = JSON). The researcher must click "Apply" before anything changes.
- Never compute or invent statistics. Use exact column names.`

const SUMMARIZE_PROMPT = `You write the results paragraph for a researcher, like the Results section of a paper or a lab-meeting slide.
Rules:
- 2–4 sentences, plain scientific English, past tense.
- Use ONLY numbers that appear in the provided statistics (including the "derived" values such as percentage differences). Never calculate new numbers, never round differently than shown except to fewer decimals, never invent P values or n.
- State the comparison, the direction and size of the effect, the test and P value, and n.
- Don't overclaim: no causal language beyond the design, no "trend" claims for P ≥ 0.05; say "did not differ significantly" instead.
- Put the paragraph in "reply". Set "legend" and "methods" to "".`

const POLISH_PROMPT = `You edit a figure legend and a statistical-methods paragraph for publication.
Rules:
- Keep every number, n, test name, P value, group name and threshold exactly as given. Copy group names, column names and units character for character (e.g. keep "Drug A 10mg" — don't add spaces, change capitals or reformat units). Do not add results, claims or analyses that aren't in the text.
- Improve flow and concision; follow the requested journal style if one is named (e.g. Nature: bold title sentence then description; Cell: STAR Methods-like wording), otherwise a general biomedical style.
- Return the new legend in "legend", the new methods in "methods", and one short sentence about what you changed in "reply".`

const CLEANUP_PROMPT = `You prepare messy lab spreadsheets for analysis in BenchPlot. Propose cleanup steps; the researcher reviews them and nothing changes until they click "Apply".
Allowed operations (op, column, argsJson):
- "trim_whitespace": column = a column name or "*" for all text columns; argsJson "{}"
- "merge_values": unify spellings of the same group, e.g. Ctrl/control/Control → Control; argsJson {"map": {"Ctrl": "Control", "control ": "Control"}} (keys must be existing values)
- "to_number": turn text like "12.5 mg", "1,234", "45%", "<0.1" into numbers; argsJson "{}"
- "rename_column": argsJson {"to": "new name"} (e.g. move units into the name: "Weight" → "Weight (g)")
- "drop_rows": remove rows whose value in column is one of the listed values, e.g. summary rows like "Mean", "SD", "Total"; argsJson {"values": ["Mean", "SD"]}
- "drop_empty_rows": column ""; argsJson "{}"
- "drop_column": remove an empty or irrelevant column; argsJson "{}"
- "fill_down": fill blank cells with the value above (merged cells exported from Excel); argsJson "{}"
- "wide_to_long": column ""; argsJson {"idColumns": [...], "valueColumns": [...], "nameColumn": "Group", "valueColumn": "Value"} — only when groups are spread across columns AND the researcher's analysis needs one group column
Rules:
- Only propose steps that fix a real problem visible in the column summary or rows. If the data is already clean, return no ops and say so.
- Use exact column names and values. Order matters (e.g. trim before merge).
- In "reply", list each step in plain words with why it's needed (bullet-like sentences).`

export function buildPrompt(req: TaskRequest): Prompt {
  const p = buildPromptText(req)
  return { ...p, effort: req.task === "advise" ? "medium" : "low" }
}

function buildPromptText(req: TaskRequest): Omit<Prompt, "effort"> {
  const history = (req.history ?? []).slice(-8)
  const columns = `Uploaded file (column metadata):\n${JSON.stringify(req.dataset ?? {}).slice(0, 14000)}`
  switch (req.task) {
    case "edit":
      return {
        system: EDIT_PROMPT,
        history,
        user: [`Current /graphSpec:\n${JSON.stringify(req.graphSpec)}`, `Allowed chart types for the current analysis: ${(req.chartTypes ?? []).join(", ")}`, columns, `Existing components: ${(req.components ?? []).map((c) => `${c.id}:${c.component}`).join(", ")}`, `Request: ${req.question}`].join("\n\n"),
      }
    case "advise":
      return { system: ADVISE_PROMPT, history, user: [`Current setup (/graphSpec):\n${JSON.stringify(req.graphSpec)}`, columns, `Researcher: ${req.question || "Which test should I use for this data?"}`].join("\n\n") }
    case "summarize":
      return { system: SUMMARIZE_PROMPT, history: [], user: [`Graph and setup:\n${JSON.stringify(req.graphSpec)}`, `Computed statistics (the only numbers you may use):\n${JSON.stringify(req.stats).slice(0, 20000)}`, `Figure legend:\n${req.figureText?.legend ?? ""}`, req.question ? `Researcher's note: ${req.question}` : ""].filter(Boolean).join("\n\n") }
    case "polish":
      return { system: POLISH_PROMPT, history: [], user: [`Legend:\n${req.figureText?.legend ?? ""}`, `Methods:\n${req.figureText?.methods ?? ""}`, `Style: ${req.question || "general biomedical journal"}`].join("\n\n") }
    case "cleanup":
      return { system: CLEANUP_PROMPT, history: [], user: [columns, `Rows (first and last rows of the file, as read):\n${JSON.stringify(req.sample).slice(0, 20000)}`, req.question ? `Researcher's note: ${req.question}` : ""].filter(Boolean).join("\n\n") }
  }
}

const str = { type: "string" } as const
export const JSON_SCHEMAS: Record<SchemaId, Record<string, unknown>> = {
  patch: {
    type: "object",
    properties: {
      reply: str,
      patches: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["updateDataModel", "updateComponents"] }, path: str, valueJson: str, componentsJson: str }, required: ["kind", "path", "valueJson", "componentsJson"], additionalProperties: false } },
    },
    required: ["reply", "patches"],
    additionalProperties: false,
  },
  text: { type: "object", properties: { reply: str, legend: str, methods: str }, required: ["reply", "legend", "methods"], additionalProperties: false },
  cleanup: {
    type: "object",
    properties: {
      reply: str,
      ops: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["trim_whitespace", "merge_values", "to_number", "rename_column", "drop_rows", "drop_empty_rows", "drop_column", "fill_down", "wide_to_long"] }, column: str, argsJson: str }, required: ["op", "column", "argsJson"], additionalProperties: false } },
    },
    required: ["reply", "ops"],
    additionalProperties: false,
  },
}
