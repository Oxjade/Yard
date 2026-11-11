import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { SettingsView } from "@/components/market/account/settings-view"
import { img } from "@/lib/data/media"
import { getEnv } from "@/server/env"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        skeleton="form"
        invite={{
          title: "Settings",
          body: "Sign in to change your details, the notifications you get, where you ship to and what you're into.",
          ...invitePhoto(getEnv().seedDemo, img("fashion/cover/3"), siteImages.settings),
        }}
      >
        <SettingsView />
      </AccountGate>
    </div>
  )
}
