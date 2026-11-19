import { lookup as dnsLookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"
import tls from "node:tls"
import type { Duplex } from "node:stream"
import zlib from "node:zlib"
import { cleanUrl, ImportUrlError, isBlockedAddress } from "./url"

/**
 * The importer's only way onto the internet (docs/IMPORTER.md). Plain Node (node:http/https, no
 * server-only), so tests can drive it with a fake resolver. Every request:
 *  - is http(s) on the default port, to a host that isn't private-looking (url.ts cleanUrl);
 *  - resolves the host first and refuses it when ANY address is private, loopback, link-local and
 *    so on (url.ts isBlockedAddress), then connects to that vetted address only (no second DNS
 *    lookup a rebinding server could answer differently);
 *  - follows at most 5 redirects by hand, checking every hop the same way;
 *  - gives up after 15 s and stops reading past its byte cap (counted after decompression);
 *  - says who it is: "YardImporter/1.0 (+https://yardstore.space)".
 *
 * Optional egress proxy: when YARD_IMPORTER_PROXY is set (http://host:port), requests tunnel
 * through it with CONNECT. The address check still runs whenever the host resolves locally; a
 * host only the proxy can resolve is left to the proxy's own policy (sandboxes and locked-down
 * servers whose DNS goes through the proxy).
 */

export const USER_AGENT = "YardImporter/1.0 (+https://yardstore.space)"
export const PAGE_CAP = 5 * 1024 * 1024
export const IMAGE_CAP = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 15_000

export type FetchFailure = "url" | "private" | "dns" | "redirects" | "status" | "too_large" | "timeout" | "network" | "type"

export class FetchRefused extends Error {
  constructor(
    public reason: FetchFailure,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "FetchRefused"
  }
}

export type Resolved = { address: string; family: 4 | 6 }
export type Resolver = (host: string) => Promise<Resolved[]>

export const systemResolver: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }))

export type FetchResult = { url: string; status: number; contentType: string; body: Buffer }
export type FetchOptions = { accept: string; maxBytes: number; timeoutMs?: number }

export type HttpTransport = (url: URL, pinned: Resolved | null, opts: FetchOptions & { signal: AbortSignal }) => Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>

/**
 * Resolves `url`'s host and returns the address to connect to. Refuses a host with any blocked
 * address. With a proxy, a host that doesn't resolve here is returned as null (the proxy resolves it).
 */
export async function vetHost(url: URL, resolve: Resolver, viaProxy: boolean): Promise<Resolved | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  let addrs: Resolved[]
  try {
    addrs = await resolve(host)
  } catch {
    if (viaProxy) return null
    throw new FetchRefused("dns", `Couldn't find ${url.hostname}. Check the address.`)
  }
  if (!addrs.length) {
    if (viaProxy) return null
    throw new FetchRefused("dns", `Couldn't find ${url.hostname}. Check the address.`)
  }
  if (addrs.some((a) => isBlockedAddress(a.address))) throw new FetchRefused("private", `${url.hostname} points to a private network, so Yard won't fetch it.`)
  return addrs.find((a) => a.family === 4) ?? addrs[0]
}

function proxyUrl(): URL | null {
  const raw = process.env.YARD_IMPORTER_PROXY?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === "http:" ? u : null
  } catch {
    return null
  }
}

/** A CONNECT tunnel to host:port through the proxy. */
function tunnel(proxy: URL, host: string, port: number, signal: AbortSignal): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port) || 80, method: "CONNECT", path: `${host}:${port}`, headers: { Host: `${host}:${port}`, "User-Agent": USER_AGENT }, signal })
    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new FetchRefused("network", `The proxy refused ${host} (${res.statusCode}).`, res.statusCode))
        return
      }
      resolve(socket)
    })
    req.once("error", (e) => reject(signal.aborted ? new FetchRefused("timeout", "The site took too long to answer.") : new FetchRefused("network", `Couldn't reach ${host}: ${(e as Error).message}`)))
    req.end()
  })
}

/** One GET with node:http(s), connected to the vetted address (or through the proxy's tunnel). */
export const nodeTransport: HttpTransport = async (url, pinned, opts) => {
  const secure = url.protocol === "https:"
  const port = Number(url.port) || (secure ? 443 : 80)
  const proxy = proxyUrl()
  const socket = proxy ? await tunnel(proxy, url.hostname, port, opts.signal) : null
  const lookup: LookupFunction | undefined = pinned
    ? (_host, options, cb) => {
        if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }])
        else cb(null, pinned.address, pinned.family)
      }
    : undefined
  const headers = { "User-Agent": USER_AGENT, Accept: opts.accept, "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en" }
  const base = { method: "GET", host: url.hostname, port, path: `${url.pathname}${url.search}`, headers, signal: opts.signal }
  // Node uses createConnection only when no agent is set; a direct request gets a fresh agent (no pooled socket to another address).
  return new Promise((resolve, reject) => {
    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
        return
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase()
      const stream = enc === "gzip" || enc === "x-gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res
      const chunks: Buffer[] = []
      let size = 0
      stream.on("data", (c: Buffer) => {
        size += c.length
        if (size > opts.maxBytes) {
          res.destroy()
          stream.destroy()
          reject(new FetchRefused("too_large", `The page is larger than ${Math.round(opts.maxBytes / 1048576)} MB.`))
          return
        }
        chunks.push(c)
      })
      stream.once("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
      stream.once("error", (e) => reject(opts.signal.aborted ? new FetchRefused("timeout", "The site took too long to answer.") : new FetchRefused("network", `The download broke off: ${(e as Error).message}`)))
    }
    const onError = (e: Error) => reject(e instanceof FetchRefused ? e : opts.signal.aborted ? new FetchRefused("timeout", "The site took too long to answer.") : new FetchRefused("network", `Couldn't reach ${url.hostname}: ${e.message}`))
    let req: http.ClientRequest
    if (secure) {
      req = https.request({ ...base, servername: url.hostname, ...(socket ? { createConnection: () => tls.connect({ socket, servername: url.hostname, ALPNProtocols: ["http/1.1"] }) } : { lookup, agent: false }) }, onResponse)
    } else {
      req = http.request({ ...base, ...(socket ? { createConnection: () => socket } : { lookup, agent: false }) }, onResponse)
    }
    req.once("error", onError)
    req.end()
  })
}

/**
 * GET with the importer's rules (see the top of this file). Returns the final URL, the status,
 * the content type and the body. Non-2xx is a FetchRefused("status") with the status attached.
 */
export async function safeGet(raw: string | URL, opts: FetchOptions, deps: { resolve?: Resolver; transport?: HttpTransport } = {}): Promise<FetchResult> {
  const resolve = deps.resolve ?? systemResolver
  const transport = deps.transport ?? nodeTransport
  const viaProxy = !deps.transport && !!proxyUrl()
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
  let url: URL
  try {
    url = cleanUrl(String(raw))
  } catch (e) {
    throw new FetchRefused("url", e instanceof ImportUrlError ? e.message : "That address can't be fetched.")
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const pinned = await vetHost(url, resolve, viaProxy)
    const res = await transport(url, pinned, { ...opts, signal })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.location
      const location = Array.isArray(loc) ? loc[0] : loc
      if (!location) throw new FetchRefused("redirects", "The site redirected nowhere.")
      try {
        url = cleanUrl(location, url)
      } catch (e) {
        throw new FetchRefused("url", e instanceof ImportUrlError ? `The site redirected somewhere Yard won't follow: ${e.message}` : "The site redirected somewhere Yard won't follow.")
      }
      continue
    }
    if (res.status < 200 || res.status >= 300) throw new FetchRefused("status", `${url.hostname} answered ${res.status}.`, res.status)
    const ct = res.headers["content-type"]
    return { url: url.toString(), status: res.status, contentType: String(Array.isArray(ct) ? ct[0] : (ct ?? "")).toLowerCase(), body: res.body }
  }
  throw new FetchRefused("redirects", "The site redirected too many times.")
}
