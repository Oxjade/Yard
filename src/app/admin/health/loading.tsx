import { PanelBone, PlatformSkeleton, ServicesBone, TrendBone } from "@/components/admin/platform/skeleton"

export default function Loading() {
  return (
    <PlatformSkeleton label="Loading health">
      <ServicesBone tiles={6} />
      <TrendBone />
      <div className="grid gap-3 @5xl:grid-cols-2">
        <PanelBone rows={3} />
        <PanelBone rows={2} />
      </div>
    </PlatformSkeleton>
  )
}
