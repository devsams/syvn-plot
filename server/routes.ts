/**
 * Dev-server API:
 *   POST /api/chat        one AI graph edit (BYOK headers or the server's own key)
 *   POST /api/verify-key  checks a key by listing the provider's models (no generation, no cost)
 *   GET  /api/ai-status   which providers have a server key, and today's free-tier usage
 *
 * Bring-your-own-key: the browser sends x-sp-provider / x-sp-model / x-sp-key on each
 * request. The key is used for that one upstream call only — never stored, never logged.
 * With your own key there is no limit; the server's key has a small daily free tier.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"

import { PROVIDER_NAMES, ProviderError, toA2uiMessages, type AgentReply, type ProviderId, type ProviderResult } from "./agent"
import { buildPrompt, TASK_SCHEMA, type Prompt, type SchemaId, type TaskId, type TaskRequest } from "./tasks"
import { anthropicChat, anthropicVerify } from "./providers/anthropic"
import { geminiChat, geminiVerify } from "./providers/gemini"
import { openaiChat, openaiVerify } from "./providers/openai"

export const DEFAULT_MODELS: Record<ProviderId, string> = { gemini: "gemini-3.5-flash-lite", openai: "gpt-4.1-mini", anthropic: "claude-haiku-5-5" }

const CHAT: Record<ProviderId, (key: string, model: string, prompt: Prompt, schema: SchemaId) => Promise<ProviderResult>> = { gemini: geminiChat, openai: openaiChat, anthropic: anthropicChat }
const TASKS: TaskId[] = ["edit", "advise", "summarize", "polish", "cleanup"]
const VERIFY: Record<ProviderId, (key: string) => Promise<void>> = { gemini: geminiVerify, openai: openaiVerify, anthropic: anthropicVerify }

export function aiRoutes(env: Record<string, string>): Plugin {
  const serverKeys: Partial<Record<ProviderId, string>> = { gemini: env.GEMINI_API_KEY, openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY }
  // Shared-key free tier is off unless FREE_DAILY_LIMIT is set (each free request costs the server owner money).
  const freeLimit = Number(env.FREE_DAILY_LIMIT ?? 0)
  const usage = new Map<string, number>() // `${day}|${client}` -> free generations used

  const clientId = (req: IncomingMessage) => `${new Date().toISOString().slice(0, 10)}|${req.socket.remoteAddress ?? "local"}`
  const quota = (req: IncomingMessage) => ({ used: usage.get(clientId(req)) ?? 0, limit: freeLimit })

  return {
    name: "syvn-plot-ai",
    configureServer(server) {
      server.middlewares.use("/api/ai-status", (req: IncomingMessage, res: ServerResponse) => {
        send(res, 200, { serverKeys: Object.fromEntries(Object.entries(serverKeys).map(([k, v]) => [k, !!v && freeLimit > 0])), defaults: DEFAULT_MODELS, quota: quota(req) })
      })

      server.middlewares.use("/api/verify-key", async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" })
        const { provider, key } = byok(req)
        if (!provider) return send(res, 400, { ok: false, error: "Pick a provider." })
        if (!key) return send(res, 400, { ok: false, error: "Paste an API key first." })
        try {
          await VERIFY[provider](key)
          send(res, 200, { ok: true, message: `${PROVIDER_NAMES[provider]} accepted this key.` })
        } catch (e) {
          send(res, 200, { ok: false, error: e instanceof ProviderError ? e.message : "Couldn't check the key right now. Try again in a moment." })
        }
      })

      server.middlewares.use("/api/chat", async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" })
        const { provider: requested, key: userKey, model: userModel } = byok(req)
        const provider: ProviderId = requested ?? "gemini"
        const model = userModel || DEFAULT_MODELS[provider]
        const ownKey = !!userKey
        const key = userKey || serverKeys[provider]

        if (!key) return send(res, 401, { code: "no_key", error: `AI features need an API key. Click “API key” and paste your own ${PROVIDER_NAMES[provider]} key — it stays in your browser and gives unlimited use.` })
        if (!ownKey && (freeLimit <= 0 || quota(req).used >= freeLimit))
          return send(res, 429, { code: "quota", error: freeLimit > 0 ? `You've used today's ${freeLimit} free AI requests. Add your own API key (“API key” button) for unlimited use.` : "AI features need your own API key. Click “API key” to add one.", quota: quota(req) })

        let body: Partial<TaskRequest>
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          return send(res, 400, { error: "The request couldn't be read." })
        }
        const task: TaskId = TASKS.includes(body.task as TaskId) ? (body.task as TaskId) : "edit"
        const question = String(body.question ?? "").trim().slice(0, 2000)
        if (task === "edit" && !question) return send(res, 400, { error: "Type what you'd like to change." })
        if (!body.dataset) return send(res, 400, { error: "Load a file before using the AI." })
        const prompt = buildPrompt({ ...body, task, question } as TaskRequest)

        try {
          const result = await CHAT[provider](key, model, prompt, TASK_SCHEMA[task])
          if (!ownKey) usage.set(clientId(req), quota(req).used + 1)
          // Log only non-sensitive metadata — never the key, never the data.
          console.log(`[ai] ${task} ${provider} ${model} ${ownKey ? "own-key" : "free-tier"} in=${result.inputTokens} out=${result.outputTokens}`)
          const meta = { usage: { provider, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, mode: ownKey ? "your key" : "free tier" }, quota: ownKey ? null : quota(req) }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = result.data as any
          if (TASK_SCHEMA[task] === "patch") {
            const { messages, problems } = toA2uiMessages(data as AgentReply)
            return send(res, 200, { task, reply: data.reply ?? "", messages, problems, ...meta })
          }
          if (TASK_SCHEMA[task] === "text") return send(res, 200, { task, reply: data.reply ?? "", legend: data.legend ?? "", methods: data.methods ?? "", ...meta })
          const problems: string[] = []
          const ops = (data.ops ?? []).flatMap((o: { op: string; column: string; argsJson: string }) => {
            try {
              return [{ op: o.op, column: o.column, args: o.argsJson ? JSON.parse(o.argsJson) : {} }]
            } catch {
              problems.push(`A cleanup step (${o.op}) had unreadable settings and was skipped.`)
              return []
            }
          })
          send(res, 200, { task, reply: data.reply ?? "", ops, problems, ...meta })
        } catch (e) {
          if (e instanceof ProviderError) return send(res, e.status, { code: e.code, error: e.message })
          send(res, 502, { code: "provider_error", error: "The AI request failed. Try again in a moment." })
        }
      })
    },
  }
}

function byok(req: IncomingMessage): { provider: ProviderId | null; key: string; model: string } {
  const p = String(req.headers["x-sp-provider"] ?? "").toLowerCase()
  const provider = p === "gemini" || p === "openai" || p === "anthropic" ? p : null
  return { provider, key: String(req.headers["x-sp-key"] ?? "").trim(), model: String(req.headers["x-sp-model"] ?? "").trim() }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 400_000) reject(new Error("too large"))
    })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}
