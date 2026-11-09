import { countries, currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { brands } from "@/lib/data/brands"
import type { PayoutProvider, TeamRole } from "./settings-store"

/** Validation and option lists for Studio settings. Pure, so server actions can reuse them. */

/** The Settings header copy, shared with the route's loading state. */
export const settingsDescription = "Your brand's profile, how you get paid, shipping and returns, and who can work in Studio. Each section saves on its own and is kept in Settings in this browser; the storefront, checkout and payouts pick changes up once the backend is connected."

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Route names and platform words a brand can't take. */
export const RESERVED_HANDLES = new Set(["admin", "studio", "brand", "brands", "shop", "drop", "drops", "search", "account", "you", "help", "settings", "api", "login", "signup", "checkout", "bag", "following", "categories", "stories", "support", site.name.toLowerCase()])

export type HandleCheck = { ok: boolean; message: string }

export function checkHandle(handle: string, ownBrandId: string): HandleCheck {
  const h = handle.trim()
  if (!h) return { ok: false, message: "Choose a handle for your storefront address." }
  if (h.length < 3) return { ok: false, message: "Use at least 3 characters." }
  if (h.length > 30) return { ok: false, message: "Use 30 characters or fewer." }
  if (!HANDLE_RE.test(h)) return { ok: false, message: "Use lowercase letters, numbers and single dashes, starting and ending with a letter or number." }
  if (h.includes("--")) return { ok: false, message: "Use single dashes only." }
  if (RESERVED_HANDLES.has(h)) return { ok: false, message: "That handle is reserved by the platform." }
  if (brands.some((b) => b.id !== ownBrandId && b.handle === h)) return { ok: false, message: "Another brand already uses this handle." }
  return { ok: true, message: "Available" }
}

/* ---------- Money inputs ---------- */

export function toInput(minor: number | null | undefined, currency: CurrencyCode) {
  if (minor === null || minor === undefined) return ""
  const major = minor / 10 ** currencies[currency].minor
  return Number.isInteger(major) ? String(major) : major.toFixed(currencies[currency].minor)
}

/** Parses "9,120.50" into minor units; null when it isn't a non-negative amount. */
export function parseAmount(text: string, currency: CurrencyCode) {
  const clean = text.replace(/[,\s]/g, "")
  if (!clean || !/^\d+(\.\d+)?$/.test(clean)) return null
  const decimals = clean.split(".")[1]?.length ?? 0
  if (decimals > currencies[currency].minor) return null
  return Math.round(Number(clean) * 10 ** currencies[currency].minor)
}

/* ---------- Payouts ---------- */

export const providerLabel: Record<PayoutProvider, string> = { paystack: "Paystack", flutterwave: "Flutterwave", bank_transfer: "Bank transfer" }

/** Local payment providers where they settle to local banks; bank transfer everywhere else. */
export function providersFor(country: CountryCode): PayoutProvider[] {
  return country === "NG" || country === "GH" || country === "KE" ? ["paystack", "flutterwave"] : ["bank_transfer"]
}

export const banksFor: Partial<Record<CountryCode, string[]>> = {
  NG: ["Access Bank", "First Bank", "GTBank", "Kuda", "Moniepoint", "OPay", "Providus Bank", "Stanbic IBTC", "UBA", "Wema Bank", "Zenith Bank"],
  GH: ["Absa Ghana", "CalBank", "Ecobank Ghana", "Fidelity Bank Ghana", "GCB Bank", "Stanbic Bank Ghana"],
  KE: ["Co-operative Bank", "Equity Bank", "KCB Bank", "NCBA", "Stanbic Bank Kenya"],
}

/**
 * Paystack bank codes for the Nigerian banks above (the NUBAN/CBN codes). Other countries send a
 * code made from the bank's name: the test recipient accepts it, and a live provider rejects it
 * with "couldn't confirm this account" rather than paying anyone else.
 */
const bankCodes: Partial<Record<CountryCode, Record<string, string>>> = {
  NG: { "Access Bank": "044", "First Bank": "011", GTBank: "058", Kuda: "50211", Moniepoint: "50515", OPay: "999992", "Providus Bank": "101", "Stanbic IBTC": "221", UBA: "033", "Wema Bank": "035", "Zenith Bank": "057" },
}

export function bankCodeFor(country: CountryCode, bankName: string) {
  const known = bankCodes[country]?.[bankName]
  if (known) return known
  const code = bankName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20).replace(/-+$/, "")
  return code.length >= 2 ? code : `${code}XX`.slice(0, 2)
}

export function accountNumberError(raw: string, country: CountryCode) {
  const v = raw.replace(/\s/g, "")
  if (!v) return "Enter the account number."
  if (country === "NG") return /^\d{10}$/.test(v) ? undefined : "Nigerian account numbers (NUBAN) have 10 digits."
  if (country === "GH") return /^\d{10,16}$/.test(v) ? undefined : "Use the 10 to 16 digit account number from your bank."
  if (country === "KE") return /^\d{10,14}$/.test(v) ? undefined : "Use the 10 to 14 digit account number from your bank."
  return /^[A-Za-z0-9]{8,34}$/.test(v) ? undefined : "Enter the account number or IBAN: 8 to 34 letters and numbers."
}

export const accountNumberLabel = (country: CountryCode) => (country === "NG" || country === "GH" || country === "KE" ? "Account number" : "Account number or IBAN")

export const scheduleLabel = { weekly: "Weekly, on Tuesdays", biweekly: "Every two weeks", monthly: "Monthly, on the 1st" } as const

/* ---------- Team ---------- */

export const roleMeta: Record<TeamRole, { label: string; can: string }> = {
  owner: { label: "Owner", can: "Everything, including payouts and the team" },
  admin: { label: "Admin", can: "Everything except payout details" },
  designer: { label: "Designer", can: "Products, collections and the storefront" },
  fulfilment: { label: "Fulfilment", can: "Orders, tracking and inventory" },
  finance: { label: "Finance", can: "Payouts, bank details and refunds" },
  viewer: { label: "Viewer", can: "Can look, can't change anything" },
}

export const invitableRoles: TeamRole[] = ["admin", "designer", "fulfilment", "finance", "viewer"]

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const countryOptions = (Object.keys(countries) as CountryCode[]).map((c) => ({ value: c, label: countries[c].name })).sort((a, b) => a.label.localeCompare(b.label))
export const currencyOptions = (Object.keys(currencies) as CurrencyCode[]).map((c) => ({ value: c, label: `${c} (${currencies[c].symbol})` }))
