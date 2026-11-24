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

const PREFIX: Record<ProviderId, string> = { gemini: "AIza", openai: "sk-", anthropic: "sk-ant-" }

/**
 * Catches pasted text that clearly isn't an API key (a URL, a sentence) and keys for
 * the wrong provider. `block` = can't be a key; otherwise a warning the person can ignore.
 */
export function keyProblem(provider: ProviderId, key: string): { block: boolean; message: string } | null {
  const k = key.trim()
  if (!k) return null
  const name = providerName(provider)
  if (/^https?:\/\//i.test(k) || k.includes("://")) return { block: true, message: "That's a web address, not an API key. Copy the key itself from your provider's console." }
  if (/\s/.test(k)) return { block: true, message: "API keys don't contain spaces. Check that you copied only the key." }
  if (k.length < 20) return { block: true, message: `That's too short to be an API key for ${name}. Check that you copied the whole key.` }
  // Most specific prefix first, so an Anthropic "sk-ant-" key isn't mistaken for an OpenAI "sk-" key.
  const owner = (["anthropic", "gemini", "openai"] as ProviderId[]).find((p) => k.startsWith(PREFIX[p]))
  if (owner && owner !== provider) return { block: false, message: `This looks like an API key for ${providerName(owner)}. Pick ${providerName(owner)} above, or paste your ${name} key.` }
  if (!k.startsWith(PREFIX[provider])) return { block: false, message: `${name} keys usually start with “${PREFIX[provider]}”. Check that this is the right key — or use Check key.` }
  return null
}

export const providerName = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id
