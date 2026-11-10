"use client"

import { useEffect, useSyncExternalStore } from "react"
import { create } from "zustand"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { BrandMark, CategorySlug, StorefrontAccent, StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import { useSession, type SessionUser } from "@/lib/stores/session"
import { errorMessage } from "@/lib/api/errors"
import { stepComplete } from "./validation"
import { getOnboarding, onboardingDataFromServer, saveOnboardingStep as saveOnboardingStepRequest, submitOnboarding as submitOnboardingRequest, type OnboardingDto, type OnboardingStatus } from "./remote"

/**
 * Merchant onboarding progress, loaded and saved against the signed-in shopper's application.
 * Passwords and full account numbers are never stored: the account step signs in through
 * the session, and the payout step keeps only the last four digits.
 */

export type StepId = "account" | "brand" | "storefront" | "business" | "product" | "payments" | "publish"

export const STEPS: { id: StepId; label: string; title: string; description: string; minutes: number }[] = [
  { id: "account", label: "Account", title: "Create your account", description: "One account runs your brand and your shopping. It takes a few seconds.", minutes: 0.5 },
  { id: "brand", label: "Brand", title: "Your brand", description: "The name, address and mark shoppers will know you by.", minutes: 1 },
  { id: "storefront", label: "Storefront", title: "Your storefront", description: "Pick a cover, a colour and a template. You can change all of it later.", minutes: 1 },
  { id: "business", label: "Business info", title: "Business info", description: "Where you sell from and how we can reach you. Shoppers never see your contact details.", minutes: 0.5 },
  { id: "product", label: "First product", title: "Add your first product", description: "One product is enough to open. Add the rest from Brand Studio.", minutes: 1 },
  { id: "payments", label: "Payments and shipping", title: "Payments and shipping", description: "How you get paid and how orders reach shoppers.", minutes: 0.5 },
  { id: "publish", label: "Submit", title: "Review and submit", description: "Check your storefront, then submit it for review. The platform team reviews new brands before they appear in the marketplace.", minutes: 0.5 },
]

export type ImageRef = { src: string; alt: string; source: "library" | "upload"; mediaId?: string }
export type SizeSystem = "apparel" | "shoes" | "one" | "custom"
export type DeliveryId = "domestic" | "regional" | "international" | "pickup"
export type PayoutMethodId = "bank" | "mobile"

export type OnboardingData = {
  account: { name: string; email: string; provider: SessionUser["provider"] | null }
  brand: {
    name: string
    handle: string
    handleEdited: boolean
    category: CategorySlug | null
    logoMode: "mark" | "upload"
    logo: ImageRef | null
    markText: string
    markEdited: boolean
    markStyle: BrandMark["style"]
    description: string
  }
  storefront: { cover: ImageRef | null; accent: StorefrontAccent; typePreset: StorefrontTypePreset; template: StorefrontTemplate | null; templateEdited: boolean }
  business: {
    country: CountryCode | null
    city: string
    address: string
    currency: CurrencyCode | null
    currencyEdited: boolean
    sellerType: "individual" | "company"
    legalName: string
    contactEmail: string
    phone: string
  }
  product: { images: ImageRef[]; name: string; description: string; price: string; sizeSystem: SizeSystem | null; sizes: { label: string; stock: string }[] }
  payments: {
    method: PayoutMethodId | null
    holder: string
    bankName: string
    /** Only the last four digits are kept, never the full number. */
    accountLast4: string
    accountSaved: boolean
    delivery: DeliveryId[]
    processingMin: string
    processingMax: string
    returnsDays: "14" | "30"
  }
}

export const emptyData: OnboardingData = {
  account: { name: "", email: "", provider: null },
  brand: { name: "", handle: "", handleEdited: false, category: null, logoMode: "mark", logo: null, markText: "", markEdited: false, markStyle: "condensed", description: "" },
  storefront: { cover: null, accent: "violet", typePreset: "condensed", template: null, templateEdited: false },
  business: { country: null, city: "", address: "", currency: null, currencyEdited: false, sellerType: "individual", legalName: "", contactEmail: "", phone: "" },
  product: { images: [], name: "", description: "", price: "", sizeSystem: null, sizes: [] },
  payments: { method: null, holder: "", bankName: "", accountLast4: "", accountSaved: false, delivery: ["domestic"], processingMin: "1", processingMax: "3", returnsDays: "14" },
}

type OnboardingState = {
  step: number
  maxReached: number
  data: OnboardingData
  savedAt: string | null
  publishedAt: string | null
  onboardingId: string | null
  /** Set once the application has created a brand (submitted, approved, or rejected and being edited). */
  brandId: string | null
  revision: number
  status: OnboardingStatus
  reviewNote: string | null
  submittedAt: string | null
  dirtySteps: StepId[]
  loadState: "loading" | "ready" | "error"
  loadedUserId: string | null
  loadError: string | null
  goTo: (step: number) => void
  next: () => void
  back: () => void
  update: <K extends keyof OnboardingData>(key: K, patch: Partial<OnboardingData[K]>) => void
  markSaved: () => void
  markPublished: () => void
  reset: () => void
}

const last = STEPS.length - 1
const stamp = () => new Date().toISOString()

const initialState = {
  step: 0,
  maxReached: 0,
  data: emptyData,
  savedAt: null,
  publishedAt: null,
  onboardingId: null,
  brandId: null,
  revision: 0,
  status: "draft" as const,
  reviewNote: null,
  submittedAt: null,
  dirtySteps: [] as StepId[],
  loadState: "loading" as const,
  loadedUserId: null,
  loadError: null,
}

export const useOnboarding = create<OnboardingState>()((set, get) => ({
  ...initialState,
  goTo: (step) => set({ step: Math.max(0, Math.min(last, step, get().maxReached)) }),
  next: () => {
    const step = Math.min(last, get().step + 1)
    set({ step, maxReached: Math.max(get().maxReached, step) })
  },
  back: () => set({ step: Math.max(0, get().step - 1) }),
  update: (key, patch) => set({ data: { ...get().data, [key]: { ...get().data[key], ...patch } }, dirtySteps: [...new Set([...get().dirtySteps, key])], savedAt: stamp() }),
  markSaved: () => set({ savedAt: stamp() }),
  markPublished: () => set({ publishedAt: stamp(), status: "submitted" }),
  reset: () => set({ ...initialState, loadState: "ready", loadedUserId: get().loadedUserId }),
}))

/**
 * The wizard used to keep its whole draft (contact details, payout last 4, photos) in this browser.
 * It lives on the server now, so the old copy is removed wherever the onboarding loads (and on
 * every sign-in or sign-out, in session/identity.ts).
 */
export const LEGACY_ONBOARDING_KEY = "nocturne-studio-onboarding"
export function clearLegacyOnboardingDraft() {
  try {
    window.localStorage.removeItem(LEGACY_ONBOARDING_KEY)
  } catch {
    /* storage blocked: nothing was kept there either */
  }
}
if (typeof window !== "undefined") clearLegacyOnboardingDraft()

const loads = new Map<string, Promise<void>>()
const loadKey = (userId: string | null) => userId ?? "guest"

function applyDto(dto: OnboardingDto, user: SessionUser) {
  const step = Math.max(0, STEPS.findIndex((item) => item.id === dto.currentStep))
  const completed = dto.completedSteps.map((id) => STEPS.findIndex((item) => item.id === id)).filter((index) => index >= 0)
  const published = dto.status === "submitted" || dto.status === "approved"
  useOnboarding.setState({
    data: onboardingDataFromServer(dto.data, user, dto.status === "approved" ? "brand" : "shopper"),
    step,
    maxReached: Math.min(last, Math.max(step, ...completed, 0)),
    savedAt: dto.updatedAt,
    publishedAt: published ? dto.submittedAt ?? dto.updatedAt : null,
    onboardingId: dto.id,
    brandId: dto.brandId,
    revision: dto.revision,
    status: dto.status,
    reviewNote: dto.reviewNote,
    submittedAt: dto.submittedAt,
    dirtySteps: [],
    loadState: "ready",
    loadedUserId: user.id,
    loadError: null,
  })
}

export function ensureOnboardingLoaded(userId: string | null = useSession.getState().user?.id ?? null, force = false): Promise<void> {
  const key = loadKey(userId)
  const state = useOnboarding.getState()
  if (!force && state.loadedUserId === userId && state.loadState === "ready") return Promise.resolve()
  const active = loads.get(key)
  if (active && !force) return active
  useOnboarding.setState({ loadState: "loading", loadedUserId: userId, loadError: null })

  const pending = Promise.resolve().then(async () => {
    try {
      const user = useSession.getState().user
      if (!userId) {
        if (useSession.getState().user) return
        useOnboarding.setState({ ...initialState, loadState: "ready", loadedUserId: null })
        return
      }
      if (!user || user.id !== userId) return
      const response = await getOnboarding()
      if (loads.get(key) !== pending || useSession.getState().user?.id !== userId) return
      const dto = response.onboarding
      if (dto) applyDto(dto, user)
      else useOnboarding.setState({ ...initialState, data: { ...emptyData, account: { name: user.name, email: user.email, provider: user.provider } }, loadState: "ready", loadedUserId: userId })
    } catch (error) {
      if (loads.get(key) !== pending || useSession.getState().user?.id !== userId) return
      useOnboarding.setState({ loadState: "error", loadedUserId: userId, loadError: errorMessage(error) })
    } finally {
      if (loads.get(key) === pending) loads.delete(key)
    }
  })
  loads.set(key, pending)
  return pending
}

export function reloadOnboarding() {
  return ensureOnboardingLoaded(useSession.getState().user?.id ?? null, true)
}

function applySavedDto(dto: OnboardingDto) {
  useOnboarding.setState({
    onboardingId: dto.id,
    brandId: dto.brandId,
    revision: dto.revision,
    status: dto.status,
    reviewNote: dto.reviewNote,
    submittedAt: dto.submittedAt,
    savedAt: dto.updatedAt,
  })
}

export async function saveOnboardingProgress(step: StepId): Promise<boolean> {
  if (step === "publish") return true
  const user = useSession.getState().user
  if (!user) throw new Error("Sign in before saving your brand application.")
  await ensureOnboardingLoaded(user.id)
  const state = useOnboarding.getState()
  if (state.loadedUserId !== user.id || state.loadState !== "ready") throw new Error(state.loadError ?? "Your application is still loading. Try again.")
  const savedData = JSON.stringify(state.data[step])
  const response = await saveOnboardingStepRequest(step, state.data, state.revision)
  if (useSession.getState().user?.id !== user.id) throw new Error("Your account changed before the application was saved. Reload to continue.")
  applySavedDto(response.onboarding)
  const current = useOnboarding.getState()
  const unchanged = JSON.stringify(current.data[step]) === savedData
  if (unchanged) useOnboarding.setState({ dirtySteps: current.dirtySteps.filter((id) => id !== step) })
  return unchanged
}

/**
 * Saves every step with unsaved edits, in wizard order. Steps reached through the step list are
 * never saved on the way, so this is what keeps their edits. `skipIncomplete` leaves out a step
 * that isn't filled in yet (the server would refuse it), for "Save and finish later". Resolves
 * false when a step changed again while it was saving.
 */
export async function saveAllOnboardingProgress({ skipIncomplete = false }: { skipIncomplete?: boolean } = {}): Promise<boolean> {
  const user = useSession.getState().user
  if (!user) throw new Error("Sign in before saving your brand application.")
  await ensureOnboardingLoaded(user.id)
  const { dirtySteps: dirty, data } = useOnboarding.getState()
  const complete = stepComplete(data)
  for (const step of STEPS.map((item) => item.id).filter((id) => id !== "publish" && dirty.includes(id) && (!skipIncomplete || complete[id]))) {
    if (!(await saveOnboardingProgress(step))) return false
  }
  return true
}

export async function submitOnboardingProgress() {
  const user = useSession.getState().user
  if (!user) throw new Error("Sign in before submitting your brand application.")
  if (!(await saveAllOnboardingProgress())) throw new Error("This step changed while it was saving. Submit again to include your latest edits.")
  const response = await submitOnboardingRequest(useOnboarding.getState().revision)
  applySavedDto(response.onboarding)
  useOnboarding.setState({ publishedAt: response.onboarding.submittedAt ?? stamp(), status: response.onboarding.status })
}

/** Loads saved progress after mount, so server HTML and the first client render agree. */
export function useOnboardingHydrated() {
  const userId = useSession((state) => state.user?.id ?? null)
  const ready = useSyncExternalStore(
    (notify) => useOnboarding.subscribe(() => notify()),
    () => {
      const state = useOnboarding.getState()
      return state.loadedUserId === userId && state.loadState !== "loading"
    },
    () => false,
  )
  useEffect(() => {
    void ensureOnboardingLoaded(userId)
  }, [userId])
  return ready
}
