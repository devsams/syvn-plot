import { useEffect, useMemo, useRef, useState } from "react"

import { Icon } from "./Icon"
import { search, type SearchEntry } from "./lib/searchIndex"

const POPULAR = ["t test", "ANOVA", "Mann–Whitney", "Tukey", "IC50", "Kaplan–Meier", "violin", "heatmap", "export PDF"]

/** Find analyses, tests, graph types, sample experiments and features. ⌘K / Ctrl+K or "/" to focus. */
export function SearchBar({ onPick }: { onPick: (e: SearchEntry) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => search(q, 12), [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onDown)
    }
  }, [])

  useEffect(() => setActive(0), [q])

  const pick = (e: SearchEntry) => {
    onPick(e)
    setQ("")
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="search" ref={boxRef} data-tour="search">
      <span className="search-icon" aria-hidden><Icon name="search" size={14} /></span>
      <input
        ref={inputRef}
        value={q}
        placeholder="Search tests, graphs, analyses, samples…"
        aria-label="Search BenchPlot"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((a) => Math.min(results.length - 1, a + 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === "Enter" && results[active]) pick(results[active])
          else if (e.key === "Escape") {
            setQ("")
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      <kbd className="search-kbd">⌘K</kbd>
      {open && (
        <div className="search-pop" role="listbox">
          {!q.trim() ? (
            <div className="search-empty">
              <div className="panel-label">Try</div>
              <div className="chips">
                {POPULAR.map((p) => (
                  <button key={p} type="button" onClick={() => { setQ(p); inputRef.current?.focus() }}>{p}</button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="search-empty dim">Nothing found for “{q}”. Try a test name (e.g. “Mann–Whitney”), a graph (“box plot”) or an assay (“ELISA”).</div>
          ) : (
            results.map((r, i) => (
              <button key={r.id} type="button" role="option" aria-selected={i === active} className={`search-row ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
                <span className={`search-type t-${r.type.toLowerCase()}`}>{r.type}</span>
                <span className="search-text">
                  <strong>{r.title}</strong>
                  <small>{r.subtitle}</small>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
