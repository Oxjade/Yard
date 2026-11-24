"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HONEYPOT_NAME, type CaptchaConfigDto, type HumanCheckFields } from "@/lib/api/contracts/human-check"

/**
 * The website's half of the bot check (src/server/http/human-check.ts) for sign-up, password
 * reset, magic links and the brand application:
 *  - a honeypot input nobody sees (off-screen, hidden from assistive tech, never in the tab order);
 *  - when the form appeared, for the server's minimum fill time;
 *  - the Cloudflare Turnstile widget, only when the server has Turnstile keys (GET /api/auth/captcha).
 *    It renders in "interaction-only" mode: most people never see it; when Cloudflare wants a
 *    click, it appears where <HumanCheck> is placed.
 *
 * const human = useHumanCheck()
 * await api(…, { body: { …, ...human.fields() } })   // then human.reset() (a token is single-use)
 * <HumanCheck check={human} />                        // inside the form
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

let configPromise: Promise<CaptchaConfigDto> | null = null
function captchaConfig(): Promise<CaptchaConfigDto> {
  configPromise ??= fetch("/api/auth/captcha", { headers: { "X-Yard-Client": "1" }, cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<CaptchaConfigDto>) : { provider: null, siteKey: null }))
    .catch(() => {
      configPromise = null
      return { provider: null, siteKey: null } as const
    })
  return configPromise
}

let scriptPromise: Promise<TurnstileApi | null> | null = null
function turnstileScript(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve) => {
    const s = document.createElement("script")
    s.src = SCRIPT
    s.async = true
    s.onload = () => resolve(window.turnstile ?? null)
    s.onerror = () => {
      scriptPromise = null
      resolve(null)
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export type HumanCheckHandle = {
  /** The fields to spread into the request body. */
  fields: () => HumanCheckFields
  /** After each request: a Turnstile token works once. */
  reset: () => void
  /** Internal: what <HumanCheck> renders (the honeypot and the Turnstile slot). */
  view: React.ReactNode
}

export function useHumanCheck(): HumanCheckHandle {
  const startedAt = useRef<number | null>(null)
  const token = useRef<string | null>(null)
  const widget = useRef<string | null>(null)
  const [hp, setHp] = useState("")
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const [siteKey, setSiteKey] = useState<string | null>(null)

  useEffect(() => {
    startedAt.current = Date.now()
    let live = true
    void captchaConfig().then((c) => live && setSiteKey(c.siteKey))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!siteKey || !slot) return
    let live = true
    void turnstileScript().then((ts) => {
      if (!live || !ts || widget.current) return
      widget.current = ts.render(slot, {
        sitekey: siteKey,
        theme: "dark",
        appearance: "interaction-only",
        callback: (t: string) => (token.current = t),
        "expired-callback": () => (token.current = null),
        "error-callback": () => (token.current = null),
      })
    })
    return () => {
      live = false
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, slot])

  const fields = useCallback(
    (): HumanCheckFields => ({
      ...(token.current ? { turnstileToken: token.current } : {}),
      ...(hp ? { hp } : {}),
      ...(startedAt.current ? { formStartedAt: startedAt.current } : {}),
    }),
    [hp],
  )
  const reset = useCallback(() => {
    token.current = null
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [])
  const view = (
    <>
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Leave this empty
          <input type="text" name={HONEYPOT_NAME} tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>
      <div ref={setSlot} className="empty:hidden" />
    </>
  )
  return { fields, reset, view }
}

/** The honeypot and the Turnstile slot (empty unless Cloudflare asks for a click). Place inside the form. */
export function HumanCheck({ check }: { check: HumanCheckHandle }) {
  return check.view
}
