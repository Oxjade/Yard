import type { Metadata } from "next"
import Link from "next/link"
import { SELLER_AGREEMENT_VERSION } from "@/lib/api/contracts/founding"

export const metadata: Metadata = { title: "Seller agreement" }

/**
 * /legal/seller-agreement: the agreement a founding brand's owner accepts when claiming their store
 * (/auth/claim stores the version and the time). OWNER: the agreement's text comes from you; until
 * it's added here, this page says so plainly rather than show terms Yard hasn't written. Bump
 * SELLER_AGREEMENT_VERSION (src/lib/api/contracts/founding.ts) whenever the text changes.
 */
export default function SellerAgreementPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-28 pb-16 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">Seller agreement</h1>
      <p className="mt-3 text-sm text-ink-3">Version {SELLER_AGREEMENT_VERSION}</p>
      <div className="mt-8 grid gap-4 text-[0.9375rem] leading-relaxed text-ink-2">
        <p>This agreement sets out how brands sell on Yard: listing, orders and fulfilment, returns, fees and payouts.</p>
        <p>
          The full text is being finalised and will be published on this page. If you&apos;re claiming your store and want to read the complete terms before you accept, reply to the email Yard sent you and we&apos;ll send them to you.
        </p>
        <p>
          <Link href="/" className="text-violet underline-offset-4 hover:underline">
            Back to Yard
          </Link>
        </p>
      </div>
    </div>
  )
}
