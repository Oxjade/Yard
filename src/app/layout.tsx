import type { Metadata, Viewport } from "next"
import { SidebarPrePaint } from "@/components/dashboard/shell/sidebar-pre-paint"
import { Providers } from "@/components/providers"
import { site } from "@/config/site"
import "./globals.css"

/**
 * Relative Open Graph images (a product's photo, for example) resolve against the public origin,
 * YARD_PUBLIC_URL, read when this module loads: pages `next build` prerenders keep the value the
 * build saw. Unset or malformed, it falls back to the server's own default (src/server/env.ts).
 */
function metadataBase() {
  try {
    return new URL(process.env.YARD_PUBLIC_URL?.trim() || "http://localhost:3000")
  } catch {
    return new URL("http://localhost:3000")
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: { default: `${site.name} — ${site.tagline}`, template: `%s — ${site.name}` },
  description: site.description,
}

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Sidebar: apply the saved collapsed preference before first paint (no layout shift). */}
        <SidebarPrePaint />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
