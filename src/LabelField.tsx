import { useEffect, useRef, useState } from "react"

/** Text field that updates as you type; Escape restores the value it opened with. */
export function LabelField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value)
  const original = useRef(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="label-field">
      <span>{label}</span>
      <input
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(original.current)
            onChange(original.current)
          }
        }}
      />
    </label>
  )
}
