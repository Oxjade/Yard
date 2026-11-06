import { settingsDescription } from "@/components/studio/business/settings-model"
import { SettingsSkeleton } from "@/components/studio/business/skeletons"

export default function SettingsLoading() {
  return <SettingsSkeleton description={settingsDescription} />
}
