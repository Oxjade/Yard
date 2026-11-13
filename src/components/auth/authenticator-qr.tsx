"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

/**
 * The two-step setup as a QR code an authenticator app scans, drawn here in the browser (the
 * secret never goes to another service). The key stays below it for typing in by hand.
 */
export function AuthenticatorQr({ otpauthUrl, secret }: { otpauthUrl: string; secret: string }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => { if (active) setSvg(s) })
      .catch(() => { if (active) setSvg(null) })
    return () => { active = false }
  }, [otpauthUrl])

  return (
    <div className="grid justify-items-center gap-3">
      {svg ? (
        <div role="img" aria-label="QR code for your authenticator app" className="size-48 rounded-md bg-white p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div aria-hidden className="size-48 animate-pulse rounded-md bg-white/10" />
      )}
      <p className="text-center text-xs text-ink-3">Scan with Google Authenticator, Authy or 1Password. Can’t scan? Enter this key:</p>
      <p className="w-full break-all rounded-md bg-obsidian px-3 py-2 text-center font-mono text-xs text-ink" aria-label="Authenticator setup key">{secret}</p>
    </div>
  )
}
