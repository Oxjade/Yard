import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function DropNotFound() {
  return (
    <div className="mx-auto flex max-w-page flex-col items-center px-4 pt-40 pb-16 text-center md:px-8 md:pt-48">
      <h1 className="font-display text-display-lg text-ink">Drop not found</h1>
      <p className="mt-4 max-w-md text-pretty text-ink-2">There&apos;s no release at this address. It may have been renamed or cancelled before it was announced.</p>
      <Button asChild variant="primary" size="lg" className="mt-8">
        <Link href="/drops">See all drops</Link>
      </Button>
    </div>
  )
}
