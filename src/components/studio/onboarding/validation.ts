import { currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import { handleMessage, handleStatus, type PayoutFormat } from "./options"
import type { OnboardingData } from "./store"

/** Field errors for one step: field name → message. An empty object means the step is valid. */
export type Errors = Record<string, string | undefined>

export const hasErrors = (e: Errors) => Object.values(e).some(Boolean)

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())

export function isPhone(s: string) {
  const digits = s.replace(/\D/g, "")
  return /^\+?[\d\s\-()]+$/.test(s.trim()) && digits.length >= 7 && digits.length <= 15
}

export function validateAccount(a: OnboardingData["account"]): Errors {
  return { account: a.email ? undefined : "Create your account or continue with Google or Apple." }
}

export function validateBrand(b: OnboardingData["brand"]): Errors {
  const status = handleStatus(b.handle)
  return {
    name: b.name.trim().length < 2 ? "Enter your brand name." : b.name.trim().length > 40 ? "Keep the name to 40 characters or fewer." : undefined,
    handle: status === "available" ? undefined : handleMessage[status],
    category: b.category ? undefined : "Choose the category you mostly sell in.",
    logo: b.logoMode === "upload" && !b.logo ? "Upload a logo, or use a generated mark for now." : undefined,
    markText: b.logoMode === "mark" && !/^[A-Za-z0-9&]{1,3}$/.test(b.markText.trim()) ? "Use 1 to 3 letters or numbers." : undefined,
    description:
      b.description.trim().length < 20
        ? "Write at least 20 characters, so shoppers know what you make."
        : b.description.trim().length > 160
          ? "Keep it to 160 characters or fewer."
          : undefined,
  }
}

export function validateStorefront(s: OnboardingData["storefront"]): Errors {
  return {
    cover: s.cover ? undefined : "Choose a cover photo or upload your own.",
    template: s.template ? undefined : "Pick a template to start from.",
  }
}

export function validateBusiness(b: OnboardingData["business"]): Errors {
  return {
    country: b.country ? undefined : "Choose the country you sell from.",
    city: b.city.trim().length < 2 ? "Enter the city you work from." : undefined,
    currency: b.currency ? undefined : "Choose the currency you price in.",
    legalName: b.sellerType === "company" && b.legalName.trim().length < 2 ? "Enter the registered business name." : undefined,
    contactEmail: isEmail(b.contactEmail) ? undefined : "Enter a valid email address.",
    phone: isPhone(b.phone) ? undefined : "Enter a phone number with its country code, for example +234 803 123 4567.",
  }
}

/** Price text in major units → integer minor units, or null if it isn't a valid price. */
export function parsePrice(price: string, currency: CurrencyCode) {
  const t = price.replace(/[,\s]/g, "")
  const minor = currencies[currency].minor
  const re = minor === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/
  if (!re.test(t)) return null
  const n = Math.round(Number(t) * 10 ** minor)
  return n > 0 ? n : null
}

export const isWhole = (s: string) => /^\d+$/.test(s.trim())

export function validateProduct(p: OnboardingData["product"], currency: CurrencyCode): Errors {
  const minor = currencies[currency].minor
  const t = p.price.replace(/[,\s]/g, "")
  const priceError = !t
    ? "Enter a price."
    : minor === 0 && /\./.test(t)
      ? `Use a whole number for ${currency}.`
      : parsePrice(p.price, currency) === null
        ? "Enter a price above zero, with up to 2 decimal places."
        : undefined
  const badStock = p.sizes.some((s) => s.stock.trim() !== "" && !isWhole(s.stock))
  const total = p.sizes.reduce((n, s) => n + (isWhole(s.stock) ? Number(s.stock) : 0), 0)
  return {
    images: p.images.length ? undefined : "Add at least one photo.",
    name: p.name.trim().length < 2 ? "Name your product." : p.name.trim().length > 80 ? "Keep the name to 80 characters or fewer." : undefined,
    description: p.description.trim().length < 20 ? "Describe it in at least 20 characters: material, fit, how it's made." : undefined,
    price: priceError,
    sizes: !p.sizeSystem ? "Choose how this product is sized." : p.sizes.length === 0 ? "Add at least one size." : undefined,
    stock: badStock ? "Stock must be a whole number." : p.sizes.length && total === 0 ? "Add stock to at least one size." : undefined,
  }
}

/* ---------- Payout account numbers (format checks the bank would also run) ---------- */

function ibanValid(raw: string, country: CountryCode) {
  const s = raw.replace(/\s/g, "").toUpperCase()
  const lengths: Partial<Record<CountryCode, number>> = { FR: 27, DE: 22 }
  if (!s.startsWith(country) || s.length !== (lengths[country] ?? s.length) || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
  let rem = 0
  for (const d of moved) rem = (rem * 10 + Number(d)) % 97
  return rem === 1
}

function abaValid(s: string) {
  if (!/^\d{9}$/.test(s)) return false
  const d = s.split("").map(Number)
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0
}

function clabeValid(s: string) {
  if (!/^\d{18}$/.test(s)) return false
  const w = [3, 7, 1]
  const sum = s
    .slice(0, 17)
    .split("")
    .reduce((n, ch, i) => n + ((Number(ch) * w[i % 3]) % 10), 0)
  return (10 - (sum % 10)) % 10 === Number(s[17])
}

export type PayoutInput = { holder: string; bankName: string; account: string; routing: string; phone: string }

export function validatePayoutAccount(format: PayoutFormat, country: CountryCode, v: PayoutInput): Errors {
  const digits = (s: string) => s.replace(/[\s-]/g, "")
  const e: Errors = { holder: v.holder.trim().length < 2 ? "Enter the account holder's name, as the bank has it." : undefined }
  if (format !== "mobile" && format !== "iban") e.bankName = v.bankName.trim().length < 2 ? "Enter your bank's name." : undefined
  switch (format) {
    case "nuban":
      e.account = /^\d{10}$/.test(digits(v.account)) ? undefined : "Nigerian account numbers are 10 digits."
      break
    case "uk":
      e.routing = /^\d{6}$/.test(digits(v.routing)) ? undefined : "Sort codes are 6 digits, like 12-34-56."
      e.account = /^\d{8}$/.test(digits(v.account)) ? undefined : "UK account numbers are 8 digits."
      break
    case "iban":
      e.account = ibanValid(v.account, country) ? undefined : `Enter a valid ${country} IBAN. Check for a missing or swapped digit.`
      break
    case "aba":
      e.routing = abaValid(digits(v.routing)) ? undefined : "Enter a valid 9-digit routing number."
      e.account = /^\d{4,17}$/.test(digits(v.account)) ? undefined : "Account numbers are 4 to 17 digits."
      break
    case "clabe":
      e.account = clabeValid(digits(v.account)) ? undefined : "Enter a valid 18-digit CLABE."
      break
    case "local":
      e.account = /^\d{6,20}$/.test(digits(v.account)) ? undefined : "Enter your account number, 6 to 20 digits."
      break
    case "mobile":
      e.phone = isPhone(v.phone) ? undefined : "Enter the wallet's phone number with its country code."
      break
  }
  return e
}

export function validateShipping(p: OnboardingData["payments"]): Errors {
  const min = Number(p.processingMin)
  const max = Number(p.processingMax)
  const wholeInRange = (s: string) => isWhole(s) && Number(s) >= 1 && Number(s) <= 30
  return {
    delivery: p.delivery.some((d) => d !== "pickup") ? undefined : "Choose at least one delivery option besides pickup.",
    processing: !wholeInRange(p.processingMin) || !wholeInRange(p.processingMax) ? "Use whole days between 1 and 30." : min > max ? "The first number can't be bigger than the second." : undefined,
  }
}

export function validatePayments(p: OnboardingData["payments"]): Errors {
  return {
    method: p.method ? undefined : "Choose how you'd like to be paid.",
    payout: p.method && !p.accountSaved ? "Add your payout details." : undefined,
    ...validateShipping(p),
  }
}

/** Whether each saved step is complete, from the stored data alone — drives the publish checklist. */
export function stepComplete(data: OnboardingData) {
  const currency = data.business.currency ?? "USD"
  return {
    account: !hasErrors(validateAccount(data.account)),
    brand: !hasErrors(validateBrand(data.brand)),
    storefront: !hasErrors(validateStorefront(data.storefront)),
    business: !hasErrors(validateBusiness(data.business)),
    product: !hasErrors(validateProduct(data.product, currency)),
    payments: !hasErrors(validatePayments(data.payments)),
  }
}
