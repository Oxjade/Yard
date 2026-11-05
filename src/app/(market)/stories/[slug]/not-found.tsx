import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function StoryNotFound() {
  return (
    <div className="mx-auto flex max-w-page flex-col items-center px-4 pt-40 pb-16 text-center md:px-8 md:pt-48">
      <h1 className="font-display text-display-lg text-ink">Story not found</h1>
      <p className="mt-4 max-w-md text-pretty text-ink-2">There&apos;s no story at this address. It may have been renamed or taken down by the brand.</p>
      <Button asChild variant="primary" size="lg" className="mt-8">
        <Link href="/stories">Read all stories</Link>
      </Button>
    </div>
  )
}
