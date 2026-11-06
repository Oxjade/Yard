import { advertisingDescription } from "@/components/studio/growth/copy"
import { ListSkeleton } from "@/components/studio/growth/form"

export default function AdvertisingLoading() {
  return <ListSkeleton title="Advertising" description={advertisingDescription} tiles={5} tabs={2} />
}
