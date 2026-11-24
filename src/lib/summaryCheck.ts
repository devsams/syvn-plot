/**
 * Numbers the AI may cite, and a check that AI-written text only uses them.
 * The statistics come from the app's own analysis; the AI never computes.
 */
import type { Result } from "./analyses"
import type { ChartSpec } from "./specs"
import { summarize } from "./stats"

/** The statistics sent to the AI for a results summary (including precomputed % differences vs the first group). */
export function statsForSummary(result: Result, charts: ChartSpec[]) {
  const groups: unknown[] = []
  const derived: unknown[] = []
  const tests: unknown[] = []
  for (const c of charts.slice(0, 3)) {
    if (c.kind !== "column") continue
    const s = c.groups.map((g) => ({ name: g.name, ...summarize(g.values) }))
    groups.push({ chart: c.title, groups: s.map((x) => ({ name: x.name, n: x.n, mean: round(x.mean), sd: round(x.sd), sem: round(x.sem), median: round(x.median) })) })
    const ref = s[0]
    if (ref && ref.mean)
      for (const x of s.slice(1)) derived.push({ chart: c.title, comparison: `${x.name} vs ${ref.name}`, percentChange: round((100 * (x.mean - ref.mean)) / Math.abs(ref.mean), 1), foldChange: round(x.mean / ref.mean, 2) })
    if (c.test) tests.push({ chart: c.title, test: c.test.name, statistic: c.test.statistic, p: c.test.p, summary: c.test.summary })
    for (const k of c.comparisons ?? []) tests.push({ chart: c.title, comparison: `${c.groups[k.b].name} vs ${c.groups[k.a].name}`, adjustedP: k.p, summary: k.summary })
  }
  return {
    headline: result.headline,
    groups,
    derived,
    tests,
    tables: result.tables.slice(0, 6).map((t) => ({ title: t.title, columns: t.columns, rows: t.rows.slice(0, 30).map((r) => r.map((v) => (typeof v === "number" ? round(v) : v))) })),
  }
}

function round(v: number, digits = 4) {
  if (!Number.isFinite(v)) return v
  return Number(v.toPrecision(digits + 1))
}

const NUM_RE = /(?<![A-Za-z])[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![A-Za-z])[-−]?\d*\.?\d+(?:[eE][-+]?\d+)?/g

function numbersIn(text: string): { raw: string; value: number; decimals: number }[] {
  return [...text.matchAll(NUM_RE)].map((m) => {
    const raw = m[0]
    const clean = raw.replace(/−/g, "-").replace(/,/g, "")
    const dec = clean.includes(".") && !/e/i.test(clean) ? clean.split(".")[1].length : 0
    return { raw, value: Number(clean), decimals: dec }
  }).filter((n) => Number.isFinite(n.value))
}

/** Every number found anywhere in the source (numbers, numeric strings, numbers inside labels like "Drug A 30mg"). */
function allowedNumbers(source: unknown): number[] {
  const out: number[] = [95, 100] // "95% CI", "100%"
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v)
    else if (typeof v === "string") for (const n of numbersIn(v)) out.push(n.value)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(source)
  return out
}

/** Numbers in `text` that don't match any number in `source` at the precision written. */
export function unverifiedNumbers(text: string, source: unknown): string[] {
  const allowed = allowedNumbers(source)
  const bad = new Set<string>()
  for (const n of numbersIn(text)) {
    const x = Math.abs(n.value)
    const tol = 0.5 * 10 ** -n.decimals + 1e-12
    const ok = allowed.some((y) => {
      const a = Math.abs(y)
      if (Math.abs(a - x) <= tol) return true
      // percentages and P values written differently: 0.0012 vs 0.12%
      if (Math.abs(a * 100 - x) <= tol || Math.abs(a / 100 - x) <= tol * 0.01) return true
      return false
    })
    if (!ok) bad.add(n.raw)
  }
  return [...bad]
}
