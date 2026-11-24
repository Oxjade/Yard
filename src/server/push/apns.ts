/**
 * APNs over HTTP/2 (node:http2, no SDK). One long-lived connection per process, reopened when
 * Apple closes it (GOAWAY, idle, error). No "server-only": apns.test.ts runs it against a local
 * HTTP/2 mock of the APNs endpoint (`origin` is http://127.0.0.1:<port> there).
 */
import http2 from "node:http2"
import { apnsAuthRefused, apnsHeaders, ProviderTokenCache, type ApnsConfig } from "./apns-core"

export type ApnsAnswer = { status: number; reason: string | null; apnsId: string | null }

const TIMEOUT_MS = 10_000

export class ApnsClient {
  private session: http2.ClientHttp2Session | null = null
  readonly tokens: ProviderTokenCache

  constructor(
    private readonly config: Pick<ApnsConfig, "keyId" | "teamId" | "key" | "origin" | "topic">,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = new ProviderTokenCache(config)
  }

  private connect(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session
    const s = http2.connect(this.config.origin)
    const drop = () => {
      if (this.session === s) this.session = null
    }
    s.on("error", drop)
    s.on("goaway", drop)
    s.on("close", drop)
    // Don't keep the process alive for an idle push connection.
    s.unref()
    this.session = s
    return s
  }

  private once(deviceToken: string, body: string, priority: 5 | 10): Promise<ApnsAnswer> {
    return new Promise<ApnsAnswer>((resolve, reject) => {
      let s: http2.ClientHttp2Session
      try {
        s = this.connect()
      } catch (e) {
        reject(e)
        return
      }
      const req = s.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${this.tokens.get(this.now())}`,
        ...apnsHeaders(this.config.topic, priority),
      })
      req.setTimeout(TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL))
      let status = 0
      let apnsId: string | null = null
      const chunks: Buffer[] = []
      req.on("response", (h) => {
        status = Number(h[":status"]) || 0
        const id = h["apns-id"]
        apnsId = typeof id === "string" ? id : null
      })
      req.on("data", (c: Buffer) => chunks.push(c))
      req.on("end", () => {
        let reason: string | null = null
        if (chunks.length) {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: unknown }
            reason = typeof j.reason === "string" ? j.reason : null
          } catch {
            reason = null
          }
        }
        if (!status) reject(new Error("APNs closed the stream without an answer"))
        else resolve({ status, reason, apnsId })
      })
      req.on("error", reject)
      req.end(body)
    })
  }

  /**
   * Sends one push. A refused provider token (403 Expired/InvalidProviderToken) is re-signed and
   * the push retried once.
   */
  async send(deviceToken: string, payload: unknown, priority: 5 | 10): Promise<ApnsAnswer> {
    const body = JSON.stringify(payload)
    let answer = await this.once(deviceToken, body, priority)
    if (apnsAuthRefused(answer.status, answer.reason)) {
      this.tokens.reset()
      answer = await this.once(deviceToken, body, priority)
    }
    return answer
  }

  close() {
    this.session?.close()
    this.session = null
  }
}
