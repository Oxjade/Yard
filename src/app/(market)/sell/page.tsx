import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { site } from "@/config/site"
import { commissionTerms } from "@/lib/commission"
import { sitePhotos } from "@/lib/site-images"

export const metadata: Metadata = {
  title: `Sell on ${site.name}`,
  description: `Open your brand's storefront on ${site.name}: one place for your pieces, drops, orders and payouts. Commission is ${commissionTerms} on completed sales.`,
}

const points = [
  { title: "Your own storefront", body: "Your pieces, collections, stories and social feed on one page with your brand's look." },
  { title: "Orders handled per brand", body: "Shoppers check out once; your part of each order, its tracking and returns are yours to manage." },
  { title: "Drops and launches", body: "Schedule drops with reminders, so followers are there the moment they open." },
  { title: "Found nearby", body: "List your store or pop-up on Around so people in your city can find and visit you." },
  { title: "Payouts", body: "Sales are collected for you and paid out to your bank account." },
  { title: "Nothing to pay upfront", body: `Listing is free. Commission is ${commissionTerms} on completed sales, and nothing before.` },
]

const steps = [
  { title: "Apply", body: "Tell us about your brand and what you make. It takes a few minutes." },
  { title: "Set up your storefront", body: "Add your logo, banner, story, shipping and payout details in Brand Studio." },
  { title: "List your pieces", body: "Add products with photos, sizes and stock, or plan your first drop." },
  { title: "Sell and get paid", body: "Fulfil orders from Brand Studio and receive your payouts." },
]

const photos = [sitePhotos.adeewaGreen, sitePhotos.greatnessWheelie, sitePhotos.saveYourSolBlack]

/** /sell: the brand side of Yard. Buying lives everywhere else; this page is for people who make things. */
export default function SellPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 pb-16 md:px-8 md:pt-32">
      <section className="grid min-w-0 gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="min-w-0">
          <p className="text-sm text-ink-2">For brands</p>
          <h1 className="mt-3 font-display text-display-lg text-balance text-ink">Sell on {site.name}</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-pretty text-ink-2">
            {site.name} is where independent brands open their storefront, run drops and reach shoppers who follow them. Apply once, set up in Brand Studio, and start selling.
          </p>
          <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button asChild variant="primary" size="lg">
              <Link href="/studio/onboarding">Apply to sell</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/studio">Already selling? Sign in to Brand Studio</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-ink-3">Commission: {commissionTerms} on completed sales.</p>
        </div>
        <div className="grid min-w-0 grid-cols-3 gap-2 md:gap-3">
          {photos.map((p, i) => (
            <div key={p.src} className={i === 1 ? "relative aspect-[3/4] translate-y-6 overflow-hidden rounded-lg" : "relative aspect-[3/4] overflow-hidden rounded-lg"}>
              <Image src={p.src} alt={p.alt} fill priority={i === 0} sizes="(min-width: 1024px) 240px, 33vw" className="object-cover" style={{ objectPosition: p.position }} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-24" aria-labelledby="sell-why">
        <h2 id="sell-why" className="font-display text-display-sm text-ink">Why brands sell on {site.name}</h2>
        <ul className="mt-8 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="min-w-0 rounded-lg border border-line-soft bg-card p-5">
              <p className="text-base text-ink">{p.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-2">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-20" aria-labelledby="sell-how">
        <h2 id="sell-how" className="font-display text-display-sm text-ink">How it works</h2>
        <ol className="mt-8 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="min-w-0 rounded-lg border border-line-soft bg-card p-5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-purple text-sm font-semibold text-ink">{i + 1}</span>
              <p className="mt-4 text-base text-ink">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 flex min-w-0 flex-col items-start gap-5 rounded-lg border border-line-soft bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="min-w-0">
          <p className="text-lg text-ink">Ready to open your storefront?</p>
          <p className="mt-1 text-sm text-ink-2">
            Questions first? See <Link href="/support" className="text-violet underline-offset-4 hover:underline">Support</Link> or read the <Link href="/legal/seller-agreement" className="text-violet underline-offset-4 hover:underline">seller agreement</Link>.
          </p>
        </div>
        <Button asChild variant="primary" size="lg" className="w-full md:w-auto">
          <Link href="/studio/onboarding">Apply to sell</Link>
        </Button>
      </section>
    </div>
  )
}
