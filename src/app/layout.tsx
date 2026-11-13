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
  applicationName: site.name,
  keywords: [
    "independent brands",
    "independent fashion brands",
    "Nigerian fashion brands",
    "African fashion",
    "Lagos fashion",
    "streetwear",
    "clothing drops",
    "limited drops",
    "shop small brands",
    "designer clothing Nigeria",
    "online fashion marketplace",
  ],
  category: "shopping",
  creator: site.name,
  publisher: site.name,
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { type: "website", siteName: site.name, locale: "en_NG", title: `${site.name} — ${site.tagline}`, description: site.description },
  twitter: { card: "summary_large_image", title: `${site.name} — ${site.tagline}`, description: site.description },
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
