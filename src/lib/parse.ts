import Papa from "papaparse"
import * as XLSX from "xlsx"
import { arrMax } from "./minmax"

export type Cell = string | number | null
export type ColumnKind = "number" | "category" | "date" | "text"

export type Column = { name: string; kind: ColumnKind; values: Cell[] }

export type Dataset = {
  fileName: string
  sheetName?: string
  sheetNames?: string[]
  columns: Column[]
  rowCount: number
}

/** Reads a CSV/TSV/XLSX/XLS file into columns. `sheet` picks an Excel sheet (first by default). */
export async function readFile(file: File, sheet?: string): Promise<Dataset> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm") || name.endsWith(".ods")) {
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const sheetName = sheet && workbook.SheetNames.includes(sheet) ? sheet : workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null })
    return { ...fromRows(file.name, rows), sheetName, sheetNames: workbook.SheetNames }
  }
  const text = await file.text()
  return parseCsvText(file.name, text)
}

export function parseCsvText(fileName: string, text: string): Dataset {
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: "greedy" })
  return fromRows(fileName, result.data)
}

function fromRows(fileName: string, raw: unknown[][], forceHeader = false): Dataset {
  const rows = raw.filter((row) => Array.isArray(row) && row.some((c) => c !== null && String(c).trim() !== ""))
  if (rows.length === 0) return { fileName, columns: [], rowCount: 0 }

  const width = arrMax([...rows.map((r) => r.length)])
  const first = rows[0]
  // Treat the first row as a header unless it is mostly numbers.
  const numericInFirst = first.filter((c) => toNumber(c) !== null).length
  // A plate-reader grid has an empty corner cell then 1, 2, 3… across the top.
  const plateHeader = (first[0] === null || String(first[0]).trim() === "" || toNumber(first[0]) === null) && first.length > 3 && first.slice(1).every((c, i) => toNumber(c) === i + 1)
  const hasHeader = forceHeader || plateHeader || numericInFirst < Math.max(1, width / 2)
  const body = hasHeader ? rows.slice(1) : rows

  const used = new Set<string>()
  const columns: Column[] = []
  for (let i = 0; i < width; i++) {
    let name = hasHeader && first[i] != null && String(first[i]).trim() ? String(first[i]).trim() : i === 0 && plateHeader ? "Row" : `Column ${i + 1}`
    while (used.has(name)) name += "*"
    used.add(name)
    const values = body.map((row) => normalize(row[i]))
    if (values.every((v) => v === null)) continue
    columns.push(classify(name, values))
  }
  return { fileName, columns, rowCount: body.length }
}

function normalize(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const text = String(value).trim()
  return text === "" ? null : text
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(/,/g, "").replace(/%$/, "")
  if (cleaned === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/

function classify(name: string, values: Cell[]): Column {
  const present = values.filter((v): v is string | number => v !== null)
  const numbers = present.map(toNumber)
  if (numbers.filter((n) => n !== null).length >= present.length * 0.9) {
    return { name, kind: "number", values: values.map((v) => (v === null ? null : toNumber(v))) }
  }
  if (present.every((v) => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
    return { name, kind: "date", values }
  }
  const unique = new Set(present.map(String)).size
  const kind: ColumnKind = unique <= Math.max(12, Math.sqrt(present.length)) && unique < present.length ? "category" : "text"
  return { name, kind, values: values.map((v) => (v === null ? null : String(v))) }
}

export function numbersOf(column: Column): number[] {
  return column.values.filter((v): v is number => typeof v === "number")
}

/** Rebuilds a dataset (re-detecting column types) from a header row and data rows. */
export function datasetFromTable(base: Dataset, header: string[], rows: Cell[][]): Dataset {
  const built = fromRows(base.fileName, [header, ...rows], true)
  return { ...built, sheetName: base.sheetName, sheetNames: base.sheetNames }
}

/** The dataset as a header + rows table. */
export function tableOf(ds: Dataset): { header: string[]; rows: Cell[][] } {
  return { header: ds.columns.map((c) => c.name), rows: Array.from({ length: ds.rowCount }, (_, i) => ds.columns.map((c) => c.values[i])) }
}
