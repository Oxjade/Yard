import { HeadOnlySkeleton, InboxBone } from "@/components/admin/platform/skeleton"

export default function Loading() {
  return (
    <HeadOnlySkeleton label="Loading notifications">
      <InboxBone rows={7} />
    </HeadOnlySkeleton>
  )
}
