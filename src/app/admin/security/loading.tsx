import { AdminIndexSkeleton } from "@/components/admin/marketplace/page-skeleton"

export default function Loading() {
  // The column is held to the page width so the four tab bones shrink on phones instead of
  // widening the page (AdminIndexSkeleton's own grid sizes to its content).
  return (
    <div className="[&>[role=status]]:grid-cols-[minmax(0,1fr)]">
      <AdminIndexSkeleton label="Loading security" tabs={4} rows={8} />
    </div>
  )
}
