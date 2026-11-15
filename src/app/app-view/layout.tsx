import type { Metadata } from "next"
import { AppViewProvider } from "@/components/app-view/app-view"

/** Reached through the ?view=app rewrite (next.config.ts); the public addresses are the /legal and /support ones. */
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * App view: the legal and help pages as the iOS and Android apps show them in a WebView
 * (/legal/<page>?view=app, /support?view=app). Only the page itself: no marketplace header, phone
 * home bar, footer, search, cart drawer, sign-in prompt, toasts or beacons; the app draws its own
 * top bar. Light or dark follows the system scheme the WebView passes (globals.css, "App view"),
 * and the body is plain server HTML with no entrance animation, so it shows without JavaScript and
 * whether or not the WebView is on screen while it loads.
 */
export default function AppViewLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppViewProvider>
      <div data-view="app" className="min-h-dvh">
        <main id="main">{children}</main>
      </div>
    </AppViewProvider>
  )
}
