"use client"

import { countries, currencies } from "@/config/markets"
import { api } from "@/lib/api/client"
import { apiUpload } from "@/lib/api/upload"
import { readImageBlob } from "./image-utils"
import { parsePrice } from "./validation"
import type { ImageRef, OnboardingData, StepId } from "./store"

export type OnboardingStatus = "draft" | "submitted" | "approved" | "rejected"

export type OnboardingDto = {
  id: string
  status: OnboardingStatus
  currentStep: StepId
  completedSteps: StepId[]
  data: Record<string, unknown>
  revision: number
  brandId: string | null
  submittedAt: string | null
  reviewedAt: string | null
  reviewNote: string | null
  updatedAt: string
}

export type OnboardingResponse = { onboarding: OnboardingDto | null; steps: StepId[] }
export type OnboardingStepResponse = { onboarding: OnboardingDto }

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {})
const text = (value: unknown) => (typeof value === "string" ? value : "")
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const mediaUrl = (id: string, as: "shopper" | "brand") => `/api/media/${encodeURIComponent(id)}?as=${as}`

function fromImage(value: unknown, as: "shopper" | "brand"): ImageRef | null {
  const image = object(value)
  if (typeof image.mediaId === "string") return { src: mediaUrl(image.mediaId, as), mediaId: image.mediaId, alt: text(image.alt), source: "upload" }
  if (typeof image.path === "string") return { src: image.path, alt: text(image.alt), source: "library" }
  return null
}

function imageInput(image: ImageRef) {
  if (image.mediaId) return { mediaId: image.mediaId, alt: image.alt }
  if (image.src.startsWith("/media/")) return { path: image.src, alt: image.alt }
  throw new Error("Wait for the photo upload to finish, then try again.")
}

function priceText(value: unknown, currency: string) {
  const minor = currencies[currency as keyof typeof currencies]?.minor ?? 2
  const amount = number(value)
  if (!minor) return String(amount)
  const scale = 10 ** minor
  return `${Math.floor(amount / scale)}.${String(amount % scale).padStart(minor, "0")}`
}

export function onboardingDataFromServer(raw: Record<string, unknown>, user: { name: string; email: string; provider: OnboardingData["account"]["provider"] }, as: "shopper" | "brand"): OnboardingData {
  const account = object(raw.account)
  const brand = object(raw.brand)
  const storefront = object(raw.storefront)
  const business = object(raw.business)
  const product = object(raw.product)
  const payments = object(raw.payments)
  const cover = fromImage({ mediaId: storefront.coverMediaId, path: storefront.coverPath }, as)
  const images = Array.isArray(product.images) ? product.images.map((image) => fromImage(image, as)).filter((image): image is ImageRef => image !== null) : []
  // No saved currency yet (business step not reached): leave it unset so picking a country suggests its currency.
  const savedCurrency = text(business.currency) in currencies ? (text(business.currency) as keyof typeof currencies) : null
  const currency = savedCurrency ?? "USD"
  const country = (text(business.country) || null) as OnboardingData["business"]["country"]
  const sizes = Array.isArray(product.sizes) ? product.sizes.map((value) => {
    const size = object(value)
    return { label: text(size.label), stock: String(number(size.stock)) }
  }) : []
  const markText = text(brand.markText)

  return {
    account: { name: text(account.name) || user.name, email: text(account.email) || user.email, provider: user.provider },
    brand: {
      name: text(brand.name),
      handle: text(brand.handle),
      handleEdited: !!brand.handle,
      category: (text(brand.category) || null) as OnboardingData["brand"]["category"],
      // Brands have no logo field yet: the wizard uses the generated mark (an older draft's logo upload is dropped on its next save).
      logoMode: "mark",
      logo: null,
      markText: markText || text(brand.name).slice(0, 2).toUpperCase(),
      markEdited: !!markText,
      markStyle: (text(brand.markStyle) || "condensed") as OnboardingData["brand"]["markStyle"],
      description: text(brand.description),
    },
    storefront: {
      cover,
      accent: (text(storefront.accent) || "violet") as OnboardingData["storefront"]["accent"],
      typePreset: (text(storefront.typePreset) || "condensed") as OnboardingData["storefront"]["typePreset"],
      template: (text(storefront.template) || null) as OnboardingData["storefront"]["template"],
      templateEdited: !!storefront.template,
    },
    business: {
      country,
      city: text(business.city),
      address: text(business.address),
      currency: savedCurrency,
      currencyEdited: savedCurrency !== null && (!country || countries[country]?.currency !== savedCurrency),
      sellerType: business.sellerType === "company" ? "company" : "individual",
      legalName: text(business.legalName),
      contactEmail: text(business.contactEmail),
      phone: text(business.phone),
    },
    product: {
      images,
      name: text(product.name),
      description: text(product.description),
      price: product.priceMinor === undefined ? "" : priceText(product.priceMinor, currency),
      sizeSystem: sizes.length ? "custom" : null,
      sizes,
    },
    payments: {
      method: (text(payments.method) || null) as OnboardingData["payments"]["method"],
      holder: text(payments.holder),
      bankName: text(payments.bankName),
      accountLast4: text(payments.accountLast4),
      accountSaved: !!payments.accountLast4,
      delivery: Array.isArray(payments.delivery) ? payments.delivery.filter((value): value is OnboardingData["payments"]["delivery"][number] => ["domestic", "regional", "international", "pickup"].includes(String(value))) : [],
      processingMin: payments.processingMin === undefined ? "1" : String(number(payments.processingMin)),
      processingMax: payments.processingMax === undefined ? "3" : String(number(payments.processingMax)),
      returnsDays: payments.returnsDays === 30 ? "30" : "14",
    },
  }
}

export function onboardingStepData(step: Exclude<StepId, "publish">, data: OnboardingData) {
  switch (step) {
    case "account":
      return { name: data.account.name, email: data.account.email }
    case "brand":
      return {
        name: data.brand.name,
        handle: data.brand.handle,
        category: data.brand.category,
        markText: data.brand.logoMode === "mark" ? data.brand.markText : undefined,
        markStyle: data.brand.markStyle,
        description: data.brand.description,
        logoMediaId: data.brand.logoMode === "upload" ? data.brand.logo?.mediaId ?? null : null,
      }
    case "storefront":
      return {
        coverMediaId: data.storefront.cover?.mediaId ?? null,
        coverPath: data.storefront.cover && !data.storefront.cover.mediaId ? data.storefront.cover.src : undefined,
        accent: data.storefront.accent,
        typePreset: data.storefront.typePreset,
        template: data.storefront.template,
      }
    case "business":
      // Only the server's fields: the step schema is strict, so a client-only flag (currencyEdited) would be refused.
      return {
        country: data.business.country,
        city: data.business.city,
        address: data.business.address,
        currency: data.business.currency,
        sellerType: data.business.sellerType,
        legalName: data.business.legalName,
        contactEmail: data.business.contactEmail,
        phone: data.business.phone,
      }
    case "product": {
      const currency = data.business.currency ?? "USD"
      const priceMinor = parsePrice(data.product.price, currency)
      if (priceMinor === null) throw new Error("Enter a valid product price before continuing.")
      return {
        name: data.product.name,
        description: data.product.description,
        priceMinor,
        images: data.product.images.map(imageInput),
        sizes: data.product.sizes.map((size) => ({ label: size.label, stock: Number(size.stock) })),
      }
    }
    case "payments":
      return {
        method: data.payments.method,
        holder: data.payments.holder,
        bankName: data.payments.bankName,
        accountLast4: data.payments.accountSaved ? data.payments.accountLast4 : undefined,
        delivery: data.payments.delivery,
        processingMin: Number(data.payments.processingMin),
        processingMax: Number(data.payments.processingMax),
        returnsDays: Number(data.payments.returnsDays),
      }
  }
}

export function getOnboarding() {
  return api<OnboardingResponse>("/api/studio/onboarding")
}

export function discardOnboarding() {
  return api<{ discarded: boolean }>("/api/studio/onboarding", { method: "DELETE" })
}

export function saveOnboardingStep(step: Exclude<StepId, "publish">, data: OnboardingData, revision: number) {
  return api<OnboardingStepResponse>(`/api/studio/onboarding/steps/${step}`, {
    method: "PUT",
    body: { data: onboardingStepData(step, data), revision },
  })
}

export function submitOnboarding(revision: number) {
  return api<OnboardingStepResponse>("/api/studio/onboarding/submit", { method: "POST", body: { revision } })
}

export function checkOnboardingHandle(handle: string, signal?: AbortSignal) {
  return api<{ handle: string; status: string; available: boolean }>("/api/studio/onboarding/handle", { query: { handle }, signal })
}

export async function uploadOnboardingImage(file: File): Promise<ImageRef> {
  const prepared = await readImageBlob(file, { max: 2048, quality: 0.86 })
  const media = await apiUpload(prepared, { purpose: "onboarding_image", as: "shopper" }).promise
  return { src: media.src, mediaId: media.id, alt: "", source: "upload" }
}