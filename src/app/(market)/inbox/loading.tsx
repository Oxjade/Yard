import { InboxSkeleton } from "@/components/inbox/inbox-app"

/** Same frame as the page (heading, then the inbox's own skeleton), so nothing jumps when it loads. */
export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-24 md:px-8 md:pt-28">
      <h1 className="mb-5 font-display text-display-sm text-ink">Inbox</h1>
      <InboxSkeleton />
    </div>
  )
}
