import { InboxSkeleton } from "@/components/inbox/inbox-app"

export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-24 md:px-8 md:pt-28">
      <InboxSkeleton />
    </div>
  )
}
