import { dropsDescription } from "@/components/studio/growth/copy"
import { ListSkeleton } from "@/components/studio/growth/form"

export default function DropsLoading() {
  return <ListSkeleton title="Drops" description={dropsDescription} tabs={5} />
}
