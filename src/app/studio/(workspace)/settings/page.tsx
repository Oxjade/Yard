import type { Metadata } from "next"
import { SettingsView } from "@/components/studio/business/settings-view"

export const metadata: Metadata = { title: "Settings" }

export default function StudioSettingsPage() {
  return <SettingsView />
}
