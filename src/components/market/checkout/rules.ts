import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import type { CheckoutInput } from "@/lib/stores/orders"

/*
 * Checkout rules per ship-to country: phone format, region and postcode requirements, and
 * the payment methods offered. Plain functions so the server action can reuse them later.
 */

type CountryRules = {
  dial: string
  /** Length of the national number, without the trunk 0. */
  phoneDigits: [number, number]
  phoneExample: string
  region: { label: string; required: boolean; options?: string[] }
  postcode: { label: string; required: boolean; pattern: RegExp; example: string }
  /** Couriers rely on landmarks where street numbering is patchy. */
  landmark: boolean
}

const NG_STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"]
const GH_REGIONS = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"]
const ZA_PROVINCES = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"]

const digits5 = /^\d{5}$/

export const countryRules: Record<CountryCode, CountryRules> = {
  NG: { dial: "+234", phoneDigits: [10, 10], phoneExample: "0803 123 4567", region: { label: "State", required: true, options: NG_STATES }, postcode: { label: "Postcode", required: false, pattern: /^\d{6}$/, example: "101245" }, landmark: true },
  GH: { dial: "+233", phoneDigits: [9, 9], phoneExample: "024 123 4567", region: { label: "Region", required: true, options: GH_REGIONS }, postcode: { label: "GhanaPost GPS address", required: false, pattern: /^[A-Z]{2}-?\d{1,4}-?\d{4}$/i, example: "GA-183-8164" }, landmark: true },
  KE: { dial: "+254", phoneDigits: [9, 9], phoneExample: "0712 345 678", region: { label: "County", required: true }, postcode: { label: "Postal code", required: false, pattern: digits5, example: "00100" }, landmark: true },
  ZA: { dial: "+27", phoneDigits: [9, 9], phoneExample: "082 123 4567", region: { label: "Province", required: true, options: ZA_PROVINCES }, postcode: { label: "Postal code", required: true, pattern: /^\d{4}$/, example: "2001" }, landmark: false },
  GB: { dial: "+44", phoneDigits: [10, 10], phoneExample: "07700 900123", region: { label: "County", required: false }, postcode: { label: "Postcode", required: true, pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, example: "E8 4DG" }, landmark: false },
  FR: { dial: "+33", phoneDigits: [9, 9], phoneExample: "06 12 34 56 78", region: { label: "Region", required: false }, postcode: { label: "Postcode", required: true, pattern: digits5, example: "75011" }, landmark: false },
  DE: { dial: "+49", phoneDigits: [7, 11], phoneExample: "01512 3456789", region: { label: "State", required: false }, postcode: { label: "Postcode", required: true, pattern: digits5, example: "10115" }, landmark: false },
  US: { dial: "+1", phoneDigits: [10, 10], phoneExample: "(212) 555-0142", region: { label: "State", required: true }, postcode: { label: "ZIP code", required: true, pattern: /^\d{5}(-\d{4})?$/, example: "10001" }, landmark: false },
  MX: { dial: "+52", phoneDigits: [10, 10], phoneExample: "55 1234 5678", region: { label: "State", required: true }, postcode: { label: "Postal code", required: true, pattern: digits5, example: "06700" }, landmark: false },
  JP: { dial: "+81", phoneDigits: [9, 10], phoneExample: "090-1234-5678", region: { label: "Prefecture", required: true }, postcode: { label: "Postal code", required: true, pattern: /^\d{3}-?\d{4}$/, example: "150-0001" }, landmark: false },
  KR: { dial: "+82", phoneDigits: [9, 10], phoneExample: "010-1234-5678", region: { label: "Province or city", required: false }, postcode: { label: "Postal code", required: true, pattern: digits5, example: "04524" }, landmark: false },
}

/* ---------- Draft shapes ---------- */

export type ContactDraft = { name: string; email: string; phone: string }
export type AddressDraft = { line1: string; line2: string; city: string; region: string; postcode: string; landmark: string }
export type PaymentMethod = CheckoutInput["paymentMethod"]
/** Only how the shopper will pay: card details are typed on Paystack's page, never on Yard. */
export type PaymentDraft = { method: PaymentMethod }
export type FieldErrors = Record<string, string>

/* ---------- Phone and email ---------- */

/** Normalises a phone number to "+234 8031234567", or null if it doesn't fit the country. */
export function parsePhone(raw: string, country: CountryCode) {
  const rules = countryRules[country]
  let n = raw.replace(/[\s\-().]/g, "")
  if (!n || !/^\+?\d+$/.test(n)) return null
  if (n.startsWith("+")) {
    if (n.startsWith(rules.dial)) n = n.slice(rules.dial.length)
    else {
      const intl = n.slice(1)
      return intl.length >= 8 && intl.length <= 15 ? `+${intl}` : null
    }
  } else if (n.startsWith("00")) {
    return parsePhone(`+${n.slice(2)}`, country)
  }
  if (n.startsWith("0")) n = n.slice(1)
  const [min, max] = rules.phoneDigits
  if (n.length < min || n.length > max) return null
  return `${rules.dial} ${n}`
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())

/* ---------- Step validators (keys are the field ids, in display order) ---------- */

export function validateContact(c: ContactDraft, country: CountryCode): FieldErrors {
  const e: FieldErrors = {}
  if (c.name.trim().length < 2) e["co-name"] = "Enter your full name."
  if (!c.email.trim()) e["co-email"] = "Enter your email address."
  else if (!isEmail(c.email)) e["co-email"] = "Enter an email address like name@example.com."
  if (!c.phone.trim()) e["co-phone"] = "Enter a phone number so couriers can reach you."
  else if (!parsePhone(c.phone, country)) e["co-phone"] = `Enter a ${countries[country].name} number, for example ${countryRules[country].phoneExample}.`
  return e
}

export function validateAddress(a: AddressDraft, country: CountryCode): FieldErrors {
  const rules = countryRules[country]
  const e: FieldErrors = {}
  if (a.line1.trim().length < 3) e["ad-line1"] = "Enter the street address."
  if (a.city.trim().length < 2) e["ad-city"] = "Enter the city or town."
  if (rules.region.required) {
    const valid = rules.region.options ? rules.region.options.includes(a.region) : a.region.trim().length >= 2
    if (!valid) e["ad-region"] = rules.region.options ? `Choose a ${rules.region.label.toLowerCase()}.` : `Enter the ${rules.region.label.toLowerCase()}.`
  }
  const pc = a.postcode.trim()
  if (!pc && rules.postcode.required) e["ad-postcode"] = `Enter the ${rules.postcode.label.toLowerCase()}.`
  else if (pc && !rules.postcode.pattern.test(pc)) e["ad-postcode"] = `Check the ${rules.postcode.label.toLowerCase()}, for example ${rules.postcode.example}.`
  return e
}

/** "Ikeja, Lagos", or just "Lagos" when the city and region match. */
export function cityLine(city: string, region: string) {
  const c = city.trim()
  const r = region.trim()
  return r && r.toLowerCase() !== c.toLowerCase() ? `${c}, ${r}` : c
}

/* ---------- Payment ---------- */

/** Currencies Paystack can charge in at all (the server's PAYSTACK_CURRENCIES). */
export const CHARGE_CURRENCIES: readonly CurrencyCode[] = ["NGN", "GHS", "ZAR", "KES", "USD"]
export const isChargeCurrency = (c: CurrencyCode) => CHARGE_CURRENCIES.includes(c)

/**
 * What a checkout charges in. `allowed` is what this deployment's Paystack account takes
 * (GET /api/checkout/options `currencies`; NGN alone on a live Nigerian account). The shopper's
 * currency when it's allowed, else the delivery country's when that is, else the first allowed
 * (NGN when it's on the list).
 */
export function chargeCurrencyFor(display: CurrencyCode, country: CountryCode, allowed: readonly CurrencyCode[]): CurrencyCode {
  const list = allowed.length ? allowed : (["NGN"] as const)
  if (list.includes(display)) return display
  const local = countries[country].currency as CurrencyCode
  if (list.includes(local)) return local
  return list.includes("NGN") ? "NGN" : list[0]
}

/**
 * The methods offered for a delivery country and the currency the checkout charges in. Paystack
 * takes each channel only in some currencies (bank transfer and USSD: NGN; mobile money: GHS and
 * KES; Instant EFT: ZAR), so a method is offered only when the charge currency is the country's own
 * and Paystack takes that channel in it (bank transfer in Ghana isn't offered). Card works in every
 * charge currency. Mirrors the server's channelsFor (src/server/payments/checkout.ts).
 */
export function paymentMethodsFor(country: CountryCode, currency: CurrencyCode): PaymentMethod[] {
  if (country === "NG" && currency === "NGN") return ["card", "bank_transfer", "ussd"]
  if (country === "GH" && currency === "GHS") return ["card", "mobile_money"]
  if (country === "KE" && currency === "KES") return ["card", "mobile_money"]
  if (country === "ZA" && currency === "ZAR") return ["card", "bank_transfer"]
  return ["card"]
}

export function paymentMethodCopy(method: PaymentMethod, country: CountryCode) {
  switch (method) {
    case "card":
      return { title: "Card", body: country === "NG" ? "Visa, Mastercard and Verve" : "Visa, Mastercard and American Express" }
    case "bank_transfer":
      return { title: "Bank transfer", body: country === "ZA" ? "Instant EFT from your banking app" : "Pay into a one-time account number" }
    case "ussd":
      return { title: "USSD", body: "Dial a short code from your phone, no data needed" }
    case "mobile_money":
      return { title: country === "KE" ? "M-Pesa or Airtel Money" : "Mobile money", body: country === "KE" ? "Approve the prompt on your phone" : "MTN MoMo, Telecel Cash or AirtelTigo Money" }
  }
}

/** What Paystack's page asks for with each method, so the shopper knows before they leave Yard. */
export function paymentMethodNext(method: PaymentMethod, country: CountryCode) {
  switch (method) {
    case "card":
      return "Yard never sees or stores your card number."
    case "bank_transfer":
      return country === "ZA"
        ? "Paystack takes you to your bank to approve the payment. Brands start preparing orders once it clears."
        : "Paystack shows a one-time account number and the exact amount to send from your banking app."
    case "ussd":
      return "Paystack shows the code to dial for your bank. Dial it from the phone number linked to your account."
    case "mobile_money":
      return "Paystack asks for your mobile money number and sends a prompt to approve on your phone."
  }
}

/** The step has nothing to type: a method from the list is all it needs. */
export function validatePayment(p: PaymentDraft, methods: PaymentMethod[]): FieldErrors {
  return methods.includes(p.method) ? {} : { "pay-ring": "Choose how you'd like to pay." }
}

/** One line describing the chosen payment, for the review step and the receipt. */
export function paymentSummary(method: PaymentMethod, country: CountryCode) {
  if (method === "card") return "Card"
  if (method === "bank_transfer") return country === "ZA" ? "Instant EFT" : "Bank transfer"
  if (method === "ussd") return "USSD"
  return "Mobile money"
}
