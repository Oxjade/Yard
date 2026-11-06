import { PlatformSkeleton, QueueBone, TablePanelBone } from "@/components/admin/platform/skeleton"

export default function Loading() {
  return (
    <PlatformSkeleton label="Loading advertising">
      <QueueBone />
      <TablePanelBone tabs={3} rows={6} />
    </PlatformSkeleton>
  )
}
