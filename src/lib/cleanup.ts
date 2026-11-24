/**
 * Cleanup steps the AI may propose. Each step is checked against the data and
 * applied locally; nothing changes until the researcher approves the preview.
 */
import { levelsOf } from "./analyses"
import { datasetFromTable, tableOf, toNumber, type Cell, type Dataset } from "./parse"

export type CleanupOp = { op: string; column: string; args: Record<string, unknown> }
export type CleanupResult = { dataset: Dataset; steps: string[]; problems: string[]; before: { rows: number; cols: number }; after: { rows: number; cols: number } }

const norm = (v: Cell) => (v === null ? "" : String(v).trim().toLowerCase())
const list = (xs: string[]) => xs.map((x) => `“${x}”`).join(", ")

export function applyCleanup(ds: Dataset, ops: CleanupOp[]): CleanupResult {
  let { header, rows } = tableOf(ds)
  const steps: string[] = []
  const problems: string[] = []
  const idx = (name: string) => header.indexOf(name)
  const need = (name: string, op: string) => {
    if (idx(name) >= 0) return true
    problems.push(`Skipped “${op}”: there's no column called “${name}”.`)
    return false
  }

  for (const o of ops) {
    const a = o.args ?? {}
    switch (o.op) {
      case "trim_whitespace": {
        const targets = o.column === "*" || !o.column ? header.map((_, i) => i) : need(o.column, o.op) ? [idx(o.column)] : []
        let n = 0
        rows = rows.map((r) => r.map((v, i) => (targets.includes(i) && typeof v === "string" && v !== v.trim().replace(/\s+/g, " ") ? (n++, v.trim().replace(/\s+/g, " ")) : v)))
        steps.push(`Trimmed extra spaces in ${o.column === "*" || !o.column ? "all text columns" : `“${o.column}”`} (${n} cells).`)
        break
      }
      case "merge_values": {
        if (!need(o.column, o.op)) break
        const i = idx(o.column)
        const map = (a.map ?? {}) as Record<string, string>
        const present = new Set(rows.map((r) => norm(r[i])))
        const valid = Object.entries(map).filter(([from]) => present.has(from.trim().toLowerCase()))
        const missing = Object.keys(map).filter((k) => !present.has(k.trim().toLowerCase()))
        if (missing.length) problems.push(`In “${o.column}”, ${list(missing)} ${missing.length > 1 ? "don't" : "doesn't"} appear, so ${missing.length > 1 ? "they were" : "it was"} left alone.`)
        const lookup = new Map(valid.map(([from, to]) => [from.trim().toLowerCase(), to]))
        let n = 0
        rows = rows.map((r) => r.map((v, k) => (k === i && v !== null && lookup.has(norm(v)) && String(v) !== lookup.get(norm(v)) ? (n++, lookup.get(norm(v))!) : v)))
        if (valid.length) steps.push(`In “${o.column}”, merged ${valid.map(([f, t]) => `“${f}” → “${t}”`).join(", ")} (${n} cells).`)
        break
      }
      case "to_number": {
        if (!need(o.column, o.op)) break
        const i = idx(o.column)
        let ok = 0
        let bad = 0
        rows = rows.map((r) =>
          r.map((v, k) => {
            if (k !== i || v === null || typeof v === "number") return v
            const cleaned = String(v).replace(/[<>≤≥~≈]/g, "").replace(/(\d),(\d{3})\b/g, "$1$2").replace(/[^\d.eE+-]+$/g, "").replace(/^[^\d.+-]+/, "").trim()
            const n = toNumber(cleaned)
            if (n === null) {
              bad++
              return v
            }
            ok++
            return n
          }),
        )
        steps.push(`Converted “${o.column}” to numbers (${ok} cells${bad ? `; ${bad} couldn't be read and were kept as text` : ""}).`)
        break
      }
      case "rename_column": {
        const to = String(a.to ?? "").trim()
        if (!need(o.column, o.op)) break
        if (!to) problems.push(`Skipped renaming “${o.column}”: no new name given.`)
        else if (header.includes(to)) problems.push(`Skipped renaming “${o.column}”: a column called “${to}” already exists.`)
        else {
          header = header.map((h) => (h === o.column ? to : h))
          steps.push(`Renamed column “${o.column}” to “${to}”.`)
        }
        break
      }
      case "drop_rows": {
        if (!need(o.column, o.op)) break
        const i = idx(o.column)
        const vals = ((a.values ?? []) as string[]).map((x) => x.trim().toLowerCase())
        const before = rows.length
        rows = rows.filter((r) => !vals.includes(norm(r[i])))
        const n = before - rows.length
        if (n) steps.push(`Removed ${n} row${n > 1 ? "s" : ""} where “${o.column}” is ${list((a.values ?? []) as string[])}.`)
        else problems.push(`No rows in “${o.column}” matched ${list((a.values ?? []) as string[])}.`)
        break
      }
      case "drop_empty_rows": {
        const before = rows.length
        rows = rows.filter((r) => r.some((v) => v !== null && String(v).trim() !== ""))
        if (before - rows.length) steps.push(`Removed ${before - rows.length} empty rows.`)
        break
      }
      case "drop_column": {
        if (!need(o.column, o.op)) break
        const i = idx(o.column)
        header = header.filter((_, k) => k !== i)
        rows = rows.map((r) => r.filter((_, k) => k !== i))
        steps.push(`Removed column “${o.column}”.`)
        break
      }
      case "fill_down": {
        if (!need(o.column, o.op)) break
        const i = idx(o.column)
        let last: Cell = null
        let n = 0
        rows = rows.map((r) => {
          if (r[i] === null || String(r[i]).trim() === "") {
            if (last !== null) n++
            return r.map((v, k) => (k === i ? last : v))
          }
          last = r[i]
          return r
        })
        steps.push(`Filled ${n} blank cells in “${o.column}” with the value above.`)
        break
      }
      case "wide_to_long": {
        const ids = ((a.idColumns ?? []) as string[]).filter((c) => need(c, o.op))
        const vals = ((a.valueColumns ?? []) as string[]).filter((c) => need(c, o.op))
        const nameCol = String(a.nameColumn ?? "Group")
        const valueCol = String(a.valueColumn ?? "Value")
        if (vals.length < 2) {
          problems.push("Skipped reshaping: it needs at least two value columns.")
          break
        }
        const out: Cell[][] = []
        for (const r of rows) for (const v of vals) if (r[idx(v)] !== null) out.push([...ids.map((c) => r[idx(c)]), v, r[idx(v)]])
        header = [...ids, nameCol, valueCol]
        rows = out
        steps.push(`Reshaped ${vals.length} columns (${list(vals)}) into “${nameCol}” and “${valueCol}” — ${out.length} rows.`)
        break
      }
      default:
        problems.push(`Skipped an unknown step (“${o.op}”).`)
    }
  }
  const dataset = datasetFromTable(ds, header, rows)
  return { dataset, steps, problems, before: { rows: ds.rowCount, cols: ds.columns.length }, after: { rows: dataset.rowCount, cols: dataset.columns.length } }
}

/** What the AI sees for cleanup: column info with value counts, plus the first and last rows. */
export function cleanupSample(ds: Dataset) {
  const { header, rows } = tableOf(ds)
  const columns = ds.columns.map((c) => {
    const counts = new Map<string, number>()
    for (const v of c.values) if (v !== null) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
    const lv = levelsOf(c)
    const unreadable = c.kind === "text" ? c.values.filter((v) => typeof v === "string" && /\d/.test(v)).slice(0, 5) : []
    return { name: c.name, kind: c.kind, empty: c.values.filter((v) => v === null).length, distinct: lv.length, values: lv.length <= 60 ? Object.fromEntries(counts) : undefined, numberLikeText: unreadable.length ? unreadable : undefined }
  })
  return { columns, sample: { header, firstRows: rows.slice(0, 15), lastRows: rows.length > 20 ? rows.slice(-5) : [] } }
}
