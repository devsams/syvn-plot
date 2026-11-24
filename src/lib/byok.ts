/**
 * Bring-your-own-key settings. Kept only in this browser (localStorage, or
 * sessionStorage when "remember" is off) and sent as headers with each AI
 * request; the server forwards the key to the provider and never stores or logs it.
 */
export type ProviderId = "gemini" | "openai" | "anthropic"

export type ByokSettings = { provider: ProviderId; model: string; key: string; remember: boolean }

export const PROVIDERS: { id: ProviderId; name: string; defaultModel: string; keyHint: string; keyUrl: string }[] = [
  { id: "gemini", name: "Google Gemini", defaultModel: "gemini-3.5-flash-lite", keyHint: "Starts with “AIza…”", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openai", name: "OpenAI", defaultModel: "gpt-4.1-mini", keyHint: "Starts with “sk-…”", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic Claude", defaultModel: "claude-haiku-5-5", keyHint: "Starts with “sk-ant-…”", keyUrl: "https://console.anthropic.com/settings/keys" },
]

const KEY = "benchplot.byok"
const empty: ByokSettings = { provider: "gemini", model: "gemini-3.5-flash-lite", key: "", remember: true }

export function loadByok(): ByokSettings {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = store().getItem(KEY)
      if (raw) {
        const saved = { ...empty, ...JSON.parse(raw) } as ByokSettings
        if (saved.provider === "anthropic" && saved.model === "claude-opus-5-5") saved.model = "claude-haiku-5-5" // old default → new cheaper default
        return saved
      }
    } catch {
      /* storage blocked */
    }
  }
  return empty
}

export function saveByok(s: ByokSettings) {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    ;(s.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: settings live for this page only */
  }
}

export function clearByok() {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Headers for one request. The key is only attached when the person has saved their own. */
export function byokHeaders(s: ByokSettings): Record<string, string> {
  const h: Record<string, string> = { "x-bp-provider": s.provider, "x-bp-model": s.model }
  if (s.key) h["x-bp-key"] = s.key
  return h
}

export const providerName = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id
