import { useEffect, useState } from "react"

import { verifyKey } from "./lib/ai"
import { keyProblem, PROVIDERS, type ByokSettings, type ProviderId } from "./lib/byok"

type Status = { serverKeys: Record<string, boolean>; quota: { used: number; limit: number } } | null

/** Bring-your-own-key: pick a provider, paste a key, optionally check it, save it in this browser. */
export function ApiKeyModal({ settings, status, onSave, onClear, onClose }: { settings: ByokSettings; status: Status; onSave: (s: ByokSettings) => void; onClear: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ByokSettings>(settings)
  const [show, setShow] = useState(false)
  const [check, setCheck] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({})
  const provider = PROVIDERS.find((p) => p.id === draft.provider)!

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const pickProvider = (id: ProviderId) => {
    const p = PROVIDERS.find((x) => x.id === id)!
    setDraft((d) => ({ ...d, provider: id, model: p.defaultModel, key: d.provider === id ? d.key : "" }))
    setCheck({})
  }

  const runCheck = async () => {
    setCheck({ busy: true })
    const r = await verifyKey(draft)
    setCheck({ ok: r.ok, message: r.message })
  }

  const free = status?.serverKeys?.[draft.provider]
  const problem = keyProblem(draft.provider, draft.key)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="key-title">
        <div className="modal-head">
          <h2 id="key-title">AI API key</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="dim">Use your own key for unlimited AI graph edits. {free ? `Without one, you get ${status?.quota.limit} free edits a day (${status?.quota.used} used today).` : "This server has no shared key for this provider, so the AI chat needs yours."}</p>

        <div className="panel-label">Provider</div>
        <div className="provider-grid">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" className={`provider ${draft.provider === p.id ? "on" : ""}`} onClick={() => pickProvider(p.id)} aria-pressed={draft.provider === p.id}>
              <strong>{p.name}</strong>
              <small>Default model: {p.defaultModel}</small>
            </button>
          ))}
        </div>

        <label className="field">
          <span>API key</span>
          <div className="key-row">
            <input type={show ? "text" : "password"} value={draft.key} placeholder={provider.keyHint} autoComplete="off" spellCheck={false} onChange={(e) => { setDraft({ ...draft, key: e.target.value.trim() }); setCheck({}) }} />
            <button type="button" onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
            <button type="button" onClick={() => void runCheck()} disabled={!draft.key || check.busy || problem?.block}>{check.busy ? "Checking…" : "Check key"}</button>
          </div>
          <small className="dim">
            Don't have one? <a href={provider.keyUrl} target="_blank" rel="noreferrer">Get a {provider.name} key</a>. Checking only lists the provider's models — it doesn't use any credit.
          </small>
        </label>
        {problem && !check.message && <div className={problem.block ? "problem" : "warn-msg"}>{problem.message}</div>}
        {check.message && <div className={check.ok ? "ok-msg" : "problem"}>{check.ok ? "✓ " : ""}{check.message}</div>}

        <label className="field">
          <span>Model</span>
          <div className="key-row">
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} spellCheck={false} />
            {draft.model !== provider.defaultModel && <button type="button" onClick={() => setDraft({ ...draft, model: provider.defaultModel })}>Reset</button>}
          </div>
        </label>

        <label className="check-row">
          <input type="checkbox" checked={draft.remember} onChange={(e) => setDraft({ ...draft, remember: e.target.checked })} />
          Remember this key on this device (otherwise it's forgotten when you close the tab)
        </label>

        <div className="privacy">
          🔒 Your key is stored only in this browser. It's sent with each AI request to the Syvn Plot server, which passes it straight to {provider.name} and never saves or logs it. Only column names, types, ranges and 5 example rows are sent — never your whole file.
        </div>

        <div className="modal-foot">
          {settings.key && <button type="button" className="danger" onClick={onClear}>Remove saved key</button>}
          <span className="grow" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!!problem?.block} onClick={() => onSave(draft)}>{draft.key ? "Save key" : free ? "Save (use free tier)" : "Save"}</button>
        </div>
      </div>
    </div>
  )
}
