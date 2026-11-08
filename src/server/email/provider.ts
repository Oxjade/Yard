import "server-only"

/**
 * Email providers behind one interface. EMAIL_PROVIDER = resend | postmark with EMAIL_API_KEY and
 * EMAIL_FROM selects a live provider; without all three the STUB is used, which sends nothing and
 * says so (outbox rows end as status 'stub', never 'sent').
 */
export type OutgoingEmail = { to: string; from: string; subject: string; text: string; html: string; headers: Record<string, string> }
export type SendResult = { ok: true; messageId: string } | { ok: false; permanent: boolean; error: string }

export interface EmailProvider {
  name: "resend" | "postmark" | "stub"
  live: boolean
  send(msg: OutgoingEmail): Promise<SendResult>
}

const TIMEOUT_MS = 10_000

function emailEnv() {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase()
  const apiKey = (process.env.EMAIL_API_KEY ?? "").trim()
  const from = (process.env.EMAIL_FROM ?? "").trim()
  return { provider, apiKey, from }
}

/** Short, secret-free error text for the outbox row. */
const clip = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 300)

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

/** 4xx other than 408/429 won't succeed on retry. */
const permanentStatus = (s: number) => s >= 400 && s < 500 && s !== 408 && s !== 429

function resend(apiKey: string): EmailProvider {
  return {
    name: "resend",
    live: true,
    async send(m) {
      try {
        const r = await post("https://api.resend.com/emails", { authorization: `Bearer ${apiKey}` }, { from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: m.headers })
        if (r.status >= 200 && r.status < 300 && typeof r.json?.id === "string") return { ok: true, messageId: r.json.id }
        return { ok: false, permanent: permanentStatus(r.status), error: clip(`resend ${r.status}: ${String(r.json?.message ?? r.json?.name ?? "error")}`) }
      } catch (e) {
        return { ok: false, permanent: false, error: clip(`resend: ${e instanceof Error ? e.name : "network error"}`) }
      }
    },
  }
}

function postmark(apiKey: string): EmailProvider {
  return {
    name: "postmark",
    live: true,
    async send(m) {
      try {
        const r = await post(
          "https://api.postmarkapp.com/email",
          { "x-postmark-server-token": apiKey },
          { From: m.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: "outbound", Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) },
        )
        if (r.status >= 200 && r.status < 300 && r.json?.ErrorCode === 0 && typeof r.json?.MessageID === "string") return { ok: true, messageId: r.json.MessageID }
        // Postmark: 406 = inactive (bounced/complained) recipient; 422 = invalid request.
        return { ok: false, permanent: permanentStatus(r.status), error: clip(`postmark ${r.status}: ${String(r.json?.Message ?? "error")}`) }
      } catch (e) {
        return { ok: false, permanent: false, error: clip(`postmark: ${e instanceof Error ? e.name : "network error"}`) }
      }
    },
  }
}

/** STUB: nothing is sent. In development the message is printed so sign-in links can be followed locally. */
const stub: EmailProvider = {
  name: "stub",
  live: false,
  async send(m) {
    if (process.env.NODE_ENV !== "production") {
      process.stdout.write(`\n[yard] EMAIL STUB (not sent — set EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM)\n  to: ${m.to}\n  subject: ${m.subject}\n${m.text.replace(/^/gm, "  | ")}\n\n`)
    }
    return { ok: false, permanent: true, error: "No email provider is configured (EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM): not sent." }
  },
}

export function emailProvider(): EmailProvider {
  const e = emailEnv()
  if (e.apiKey && e.from) {
    if (e.provider === "resend") return resend(e.apiKey)
    if (e.provider === "postmark") return postmark(e.apiKey)
  }
  return stub
}

export function emailFrom() {
  return emailEnv().from || "Yard <no-reply@localhost>"
}

/** True when a live provider is configured (AUTH can tell users email isn't switched on). */
export function emailConfigured() {
  return emailProvider().live
}
