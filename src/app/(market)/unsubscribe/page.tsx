import { Suspense } from "react"
import { UnsubscribeForm } from "./unsubscribe-form"

export const metadata = { title: "Email preferences" }

export default function UnsubscribePage() {
  return (
    <main className="mx-auto min-h-[65dvh] max-w-page px-4 pt-32 pb-20 md:px-8">
      <section className="mx-auto grid max-w-xl gap-4">
        <p className="text-xs font-medium uppercase text-ink-3">Yard email preferences</p>
        <h1 className="font-display text-display-md text-ink">Unsubscribe</h1>
        <Suspense fallback={<p role="status" className="text-sm text-ink-2">Checking this link…</p>}>
          <UnsubscribeForm />
        </Suspense>
      </section>
    </main>
  )
}