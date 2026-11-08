import "server-only"
import { getEnv } from "../env"

/**
 * Yard's branded email layout (ENGAGEMENT v3). Templates (templates.ts) describe an email as
 * plain strings; this module turns them into table-based, inline-styled HTML that matches the site
 * (obsidian page, acid accent) and a plain-text twin. Every string is HTML-escaped here, and every
 * link and image it receives has already been checked against Yard's origin by renderEmail.
 * Footer links to social profiles come only from server env vars, never from a caller.
 *
 * Client notes: 600px max, fluid to 320px; a solid dark bgcolor on body and every surface (plus a
 * same-colour background-image, which Gmail's dark mode does not recolour); text is #f5f5f5, never
 * pure white; the button is a VML roundrect in Outlook (mso) and a padded link elsewhere.
 */

export type Fact = { label: string; value: string }
export type ReceiptLine = { title: string; variant?: string; qty: number; price?: string; image?: string | null }
export type ReceiptGroup = { brand: string; eta?: string; lines: ReceiptLine[]; more?: number; shipping?: string; subtotal?: string }
export type Receipt = { reference: string; placed?: string; groups: ReceiptGroup[]; subtotal?: string; shipping?: string; total?: string; shipTo?: string }

export type EmailContent = {
  /** Inbox preview text (hidden in the body). */
  preheader: string
  eyebrow?: string
  heading: string
  greeting?: string
  paragraphs: string[]
  /** "full": the card's width (drop covers); "product": a 240px product shot. */
  hero?: { src: string; alt: string; size?: "full" | "product" } | null
  facts?: Fact[]
  receipt?: Receipt | null
  steps?: { title: string; steps: string[] } | null
  action?: { label: string; url: string } | null
  /** Print the action URL under the button (auth links, so they can be pasted). */
  showUrl?: boolean
  /** A small line under the button (expiry, a safety note). */
  note?: string
  /** "Why you're getting this" line in the footer. */
  why: string
  unsubscribeUrl?: string | null
}

/* ---------- Tokens (the app's) ---------- */

const C = { obsidian: "#080808", card: "#131313", elevated: "#1b1b1b", line: "#242424", ink: "#f5f5f5", muted: "#858585", soft: "#bdbdbd", acid: "#f5ff00", violet: "#9452ff" }
const BODY = "'Space Grotesk',Helvetica,Arial,sans-serif"
const DISPLAY = "Archivo,'Arial Narrow',Helvetica,Arial,sans-serif"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
/** A solid background Gmail's dark mode leaves alone. */
const bg = (c: string) => `background-color:${c};background-image:linear-gradient(${c},${c});`

/* ---------- Footer configuration (server env only) ---------- */

const SOCIALS = [
  ["YARD_SOCIAL_INSTAGRAM", "Instagram"],
  ["YARD_SOCIAL_TIKTOK", "TikTok"],
  ["YARD_SOCIAL_X", "X"],
] as const

function footerConfig() {
  const origin = getEnv().publicOrigin
  let host = "yard.example"
  try {
    host = new URL(origin).hostname.replace(/^www\./, "")
  } catch {
    /* keep the placeholder */
  }
  const support = (process.env.YARD_SUPPORT_EMAIL ?? "").trim() || `support@${host}`
  const address = (process.env.YARD_BUSINESS_ADDRESS ?? "").trim().slice(0, 300)
  const socials: { label: string; url: string }[] = []
  for (const [key, label] of SOCIALS) {
    const raw = (process.env[key] ?? "").trim()
    try {
      if (raw && new URL(raw).protocol === "https:") socials.push({ label, url: raw })
    } catch {
      /* ignore a malformed value */
    }
  }
  return { origin, support: /^[^\s@<>"]+@[^\s@<>"]+$/.test(support) ? support : `support@${host}`, address, socials }
}

/* ---------- Pieces ---------- */

const PREHEADER_PAD = "&#8199;&#65279;&#847; ".repeat(60)

function button(a: { label: string; url: string }) {
  const url = esc(a.url)
  const label = esc(a.label)
  const width = Math.min(520, Math.max(200, Math.round(a.label.length * 9.5) + 72))
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0"><tr><td align="left">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:52px;v-text-anchor:middle;width:${width}px;" arcsize="50%" stroke="f" fillcolor="${C.acid}"><w:anchorlock/><center style="color:${C.obsidian};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${url}" class="y-btn" target="_blank" style="display:inline-block;${bg(C.acid)}color:${C.obsidian};font-family:${BODY};font-size:15px;font-weight:700;line-height:20px;text-decoration:none;padding:16px 30px;border-radius:999px;mso-hide:all"><span class="y-btn-text" style="color:${C.obsidian}">${label}&nbsp;&nbsp;&rarr;</span></a><!--<![endif]-->
</td></tr></table>`
}

function factsTable(rows: Fact[]) {
  const cells = rows
    .map(
      (r, i) =>
        `<tr><td style="padding:14px 18px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${BODY};font-size:12px;line-height:20px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};white-space:nowrap" valign="top">${esc(r.label)}</td><td align="right" style="padding:14px 18px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${BODY};font-size:15px;line-height:20px;color:${C.ink};font-weight:500;word-break:break-word">${esc(r.value)}</td></tr>`,
    )
    .join("")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.elevated}" style="${bg(C.elevated)}border:1px solid ${C.line};border-radius:12px;border-collapse:separate;margin:8px 0 24px">${cells}</table>`
}

function stepsBlock(s: { title: string; steps: string[] }) {
  const rows = s.steps
    .map(
      (t, i) =>
        `<tr><td width="36" valign="top" style="padding:0 0 14px;font-family:${DISPLAY};font-size:15px;line-height:22px;font-weight:800;color:${C.acid}">${String(i + 1).padStart(2, "0")}</td><td valign="top" style="padding:0 0 14px;font-family:${BODY};font-size:15px;line-height:22px;color:${C.ink}">${esc(t)}</td></tr>`,
    )
    .join("")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.elevated}" style="${bg(C.elevated)}border:1px solid ${C.line};border-radius:12px;border-collapse:separate;margin:8px 0 24px"><tr><td style="padding:18px 18px 6px">
<div style="font-family:${BODY};font-size:12px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};padding-bottom:14px">${esc(s.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`
}

const label = (t: string) => `<div style="font-family:${BODY};font-size:11px;line-height:14px;letter-spacing:.1em;text-transform:uppercase;color:${C.muted}">${esc(t)}</div>`
const perforation = `<tr><td style="padding:0 20px"><div style="border-top:2px dashed ${C.line};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>`

function receiptBlock(r: Receipt) {
  const head = `<tr><td style="padding:20px 20px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top">${label("Order")}<div style="font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};padding-top:4px;letter-spacing:.02em">${esc(r.reference)}</div>${r.placed ? `<div style="font-family:${BODY};font-size:13px;line-height:18px;color:${C.muted};padding-top:2px">${esc(r.placed)}</div>` : ""}</td>
${r.total ? `<td valign="top" align="right">${label("Total")}<div style="font-family:${DISPLAY};font-size:22px;line-height:26px;font-weight:800;color:${C.acid};padding-top:4px;white-space:nowrap">${esc(r.total)}</div></td>` : ""}
</tr></table></td></tr>`

  const groups = r.groups
    .map((g, gi) => {
      const lines = g.lines
        .map((l) => {
          const thumb = l.image
            ? `<img src="${esc(l.image)}" width="56" height="70" alt="" class="y-thumb" style="display:block;width:56px;height:70px;object-fit:cover;border-radius:8px;border:0;${bg(C.elevated)}">`
            : `<div class="y-thumb" style="width:56px;height:70px;border-radius:8px;${bg(C.elevated)}border:1px solid ${C.line}"></div>`
          const sub = [l.variant, `Qty\u00a0${l.qty}`].filter(Boolean).join(" · ")
          return `<tr><td width="56" valign="top" style="padding:0 0 14px">${thumb}</td>
<td valign="top" style="padding:2px 12px 14px 14px;font-family:${BODY}"><div style="font-size:15px;line-height:20px;font-weight:500;color:${C.ink};word-break:break-word">${esc(l.title)}</div><div style="font-size:13px;line-height:18px;color:${C.muted};padding-top:3px">${esc(sub)}</div></td>
<td valign="top" align="right" style="padding:2px 0 14px;font-family:${BODY};font-size:15px;line-height:20px;color:${C.ink};white-space:nowrap">${l.price ? esc(l.price) : ""}</td></tr>`
        })
        .join("")
      const more = g.more ? `<tr><td colspan="3" style="padding:0 0 12px;font-family:${BODY};font-size:13px;line-height:18px;color:${C.muted}">+ ${g.more} more item${g.more === 1 ? "" : "s"}</td></tr>` : ""
      const ship = g.shipping ? `<tr><td colspan="2" style="padding:2px 0 0;font-family:${BODY};font-size:13px;line-height:18px;color:${C.muted}">Shipping</td><td align="right" style="padding:2px 0 0;font-family:${BODY};font-size:13px;line-height:18px;color:${C.muted};white-space:nowrap">${esc(g.shipping)}</td></tr>` : ""
      return `${gi ? `<tr><td style="padding:0 20px"><div style="border-top:1px solid ${C.line};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>` : ""}<tr><td style="padding:18px 20px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="bottom" class="y-block" style="font-family:${DISPLAY};font-size:13px;line-height:18px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${C.ink}">${esc(g.brand)}</td>${g.eta ? `<td valign="bottom" align="right" class="y-stack" style="font-family:${BODY};font-size:12px;line-height:18px;color:${C.violet};white-space:nowrap">Arrives ${esc(g.eta)}</td>` : ""}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px">${lines}${more}${ship}</table></td></tr>`
    })
    .join("")

  const totals = [r.subtotal ? ["Subtotal", r.subtotal] : null, r.shipping ? ["Shipping", r.shipping] : null].filter((x): x is [string, string] => !!x)
  const sums = `<tr><td style="padding:16px 20px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${totals.map(([k, val]) => `<tr><td style="padding:3px 0;font-family:${BODY};font-size:14px;line-height:20px;color:${C.muted}">${k}</td><td align="right" style="padding:3px 0;font-family:${BODY};font-size:14px;line-height:20px;color:${C.soft};white-space:nowrap">${esc(val)}</td></tr>`).join("")}
${r.total ? `<tr><td style="padding:10px 0 0;font-family:${BODY};font-size:15px;line-height:22px;font-weight:700;color:${C.ink}">Total</td><td align="right" style="padding:10px 0 0;font-family:${DISPLAY};font-size:18px;line-height:22px;font-weight:800;color:${C.ink};white-space:nowrap">${esc(r.total)}</td></tr>` : ""}
</table></td></tr>`
  const ship = r.shipTo ? `${perforation}<tr><td style="padding:16px 20px 20px">${label("Delivering to")}<div style="font-family:${BODY};font-size:14px;line-height:21px;color:${C.ink};padding-top:6px;word-break:break-word">${esc(r.shipTo)}</div></td></tr>` : ""

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.elevated}" style="${bg(C.elevated)}border:1px solid ${C.line};border-radius:14px;border-collapse:separate;margin:8px 0 28px">
${head}${perforation}${groups}${perforation}${sums}${ship}</table>`
}

/* ---------- Document ---------- */

export function layoutHtml(c: EmailContent): string {
  const f = footerConfig()
  const logo = `${f.origin}/brand/yard-logo-email-acid.png`
  const p = (t: string, first: boolean) => `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:25px;color:${first ? C.ink : C.soft}">${esc(t)}</p>`
  const footerLines = [
    `<p style="margin:0 0 10px">${esc(c.why)}${c.unsubscribeUrl ? ` <a href="${esc(c.unsubscribeUrl)}" style="color:${C.ink};text-decoration:underline">Unsubscribe</a> or <a href="${esc(`${f.origin}/you/settings`)}" style="color:${C.ink};text-decoration:underline">manage notifications</a>.` : ""}</p>`,
    `<p style="margin:0 0 10px">Questions? <a href="mailto:${esc(f.support)}" style="color:${C.ink};text-decoration:underline">${esc(f.support)}</a></p>`,
    f.socials.length ? `<p style="margin:0 0 10px">${f.socials.map((s) => `<a href="${esc(s.url)}" style="color:${C.ink};text-decoration:none;font-weight:500">${esc(s.label)}</a>`).join(`<span style="color:${C.line}">&nbsp;&nbsp;/&nbsp;&nbsp;</span>`)}</p>` : "",
    `<p style="margin:0">&copy; ${new Date().getUTCFullYear()} Yard${f.address ? ` &middot; ${esc(f.address)}` : ""}</p>`,
  ].join("")

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(c.heading)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,div,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
:root{color-scheme:dark light;supported-color-schemes:dark light}
html,body{margin:0!important;padding:0!important;width:100%!important;background:${C.obsidian}}
body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
u + .body a{color:inherit}
@media (prefers-color-scheme:dark){.y-bg{background-color:${C.obsidian}!important}.y-card{background-color:${C.card}!important}.y-btn{background-color:${C.acid}!important}.y-btn-text{color:${C.obsidian}!important}}
[data-ogsc] .y-btn-text{color:${C.obsidian}!important}
[data-ogsb] .y-btn{background-color:${C.acid}!important}
[data-ogsb] .y-bg{background-color:${C.obsidian}!important}
[data-ogsb] .y-card{background-color:${C.card}!important}
@media screen and (max-width:620px){
.y-pad{padding-left:20px!important;padding-right:20px!important}
.y-cardpad{padding:28px 22px 26px!important}
.y-h1{font-size:36px!important;line-height:35px!important}
.y-outer{padding:16px 10px 28px!important}
.y-block{display:block!important;width:100%!important}
.y-stack{display:block!important;width:100%!important;text-align:left!important;padding-top:4px!important}
}
</style>
</head>
<body class="body y-bg" bgcolor="${C.obsidian}" style="margin:0;padding:0;${bg(C.obsidian)}color:${C.ink}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.obsidian}">${esc(c.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" class="y-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.obsidian}" style="${bg(C.obsidian)}">
<tr><td align="center" class="y-outer" style="padding:28px 16px 40px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="y-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.obsidian}" style="max-width:600px;width:100%;${bg(C.obsidian)}border-radius:20px;word-break:break-word;overflow-wrap:anywhere">
<tr><td class="y-pad" style="padding:12px 8px 22px">
<a href="${esc(f.origin)}" target="_blank" style="text-decoration:none"><img src="${esc(logo)}" width="120" height="47" alt="Yard" style="display:block;width:120px;height:47px;border:0;color:${C.acid};font-family:${DISPLAY};font-size:24px;font-weight:800;font-style:italic"></a>
</td></tr>
<tr><td class="y-card y-cardpad" bgcolor="${C.card}" style="${bg(C.card)}border:1px solid ${C.line};border-radius:18px;padding:40px 40px 36px">
${c.eyebrow ? `<div style="font-family:${BODY};font-size:12px;line-height:16px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.acid};padding-bottom:14px">${esc(c.eyebrow)}</div>` : ""}
<h1 class="y-h1" style="margin:0 0 22px;font-family:${DISPLAY};font-size:44px;line-height:42px;font-weight:800;font-stretch:62%;letter-spacing:-.005em;text-transform:uppercase;color:${C.ink}">${esc(c.heading)}</h1>
${c.hero ? (c.hero.size === "product" ? `<img src="${esc(c.hero.src)}" width="240" alt="${esc(c.hero.alt)}" style="display:block;width:240px;max-width:100%;height:auto;border:0;border-radius:12px;margin:0 0 24px;${bg(C.elevated)}">` : `<img src="${esc(c.hero.src)}" width="518" alt="${esc(c.hero.alt)}" style="display:block;width:100%;max-width:518px;height:auto;border:0;border-radius:12px;margin:0 0 24px;${bg(C.elevated)}">`) : ""}
${c.greeting ? p(c.greeting, true) : ""}
${c.paragraphs.map((t, i) => p(t, !c.greeting && i === 0)).join("\n")}
${c.facts?.length ? factsTable(c.facts) : ""}
${c.receipt ? receiptBlock(c.receipt) : ""}
${c.steps?.steps.length ? stepsBlock(c.steps) : ""}
${c.action ? button(c.action) : ""}
${c.note ? `<p style="margin:18px 0 0;font-family:${BODY};font-size:13px;line-height:20px;color:${C.muted}">${esc(c.note)}</p>` : ""}
${c.action && c.showUrl ? `<p style="margin:14px 0 0;font-family:${BODY};font-size:12px;line-height:18px;color:${C.muted};word-break:break-all">Button not working? Paste this into your browser:<br><a href="${esc(c.action.url)}" style="color:${C.soft};text-decoration:underline">${esc(c.action.url)}</a></p>` : ""}
</td></tr>
<tr><td class="y-pad" style="padding:26px 8px 12px;font-family:${BODY};font-size:12px;line-height:19px;color:${C.muted}">
<div style="width:28px;height:3px;line-height:3px;font-size:0;${bg(C.acid)}border-radius:2px;margin:0 0 18px">&nbsp;</div>
${footerLines}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`
}

export function layoutText(c: EmailContent): string {
  const f = footerConfig()
  const out: string[] = [c.heading.toUpperCase(), ""]
  if (c.greeting) out.push(c.greeting, "")
  for (const p of c.paragraphs) out.push(p, "")
  if (c.facts?.length) out.push(...c.facts.map((r) => `${r.label}: ${r.value}`), "")
  if (c.receipt) {
    const r = c.receipt
    out.push(`Order ${r.reference}${r.placed ? ` · ${r.placed}` : ""}`, "")
    for (const g of r.groups) {
      out.push(`${g.brand.toUpperCase()}${g.eta ? ` (arrives ${g.eta})` : ""}`)
      for (const l of g.lines) out.push(`  ${l.qty} × ${l.title}${l.variant ? ` (${l.variant})` : ""}${l.price ? `  ${l.price}` : ""}`)
      if (g.more) out.push(`  + ${g.more} more`)
      if (g.shipping) out.push(`  Shipping  ${g.shipping}`)
      out.push("")
    }
    if (r.subtotal) out.push(`Subtotal: ${r.subtotal}`)
    if (r.shipping) out.push(`Shipping: ${r.shipping}`)
    if (r.total) out.push(`Total: ${r.total}`)
    if (r.shipTo) out.push("", `Delivering to: ${r.shipTo}`)
    out.push("")
  }
  if (c.steps?.steps.length) out.push(c.steps.title, ...c.steps.steps.map((s, i) => `${i + 1}. ${s}`), "")
  if (c.action) out.push(`${c.action.label}: ${c.action.url}`, "")
  if (c.note) out.push(c.note, "")
  out.push("—", c.why)
  if (c.unsubscribeUrl) out.push(`Unsubscribe: ${c.unsubscribeUrl}`)
  out.push(`Questions? ${f.support}`)
  if (f.socials.length) out.push(f.socials.map((s) => `${s.label}: ${s.url}`).join("  "))
  out.push(`© ${new Date().getUTCFullYear()} Yard${f.address ? ` · ${f.address}` : ""}`)
  return out.join("\n")
}
