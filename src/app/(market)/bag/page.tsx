import type { Metadata } from "next"
import { BagView } from "@/components/market/checkout/bag-view"

export const metadata: Metadata = {
  title: "Bag",
  robots: { index: false },
}

export default function BagPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <BagView />
    </div>
  )
}
