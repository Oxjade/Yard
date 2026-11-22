import type { Metadata, Viewport } from "next"
import { SidebarPrePaint } from "@/components/dashboard/shell/sidebar-pre-paint"
import { Providers } from "@/components/providers"
import { site } from "@/config/site"
import { siteVerification } from "@/lib/seo/site-verification"
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
  title: { default: site.seoTitle, template: `%s — ${site.name}` },
  description: site.seoDescription,
  applicationName: site.name,
  keywords: [
    "independent brands",
    "limited drops",
    "shop small brands",
    "independent brand marketplace",
    "independent fashion brands",
    "streetwear",
    "sneakers",
    "jewelry",
    "beauty",
    "art and design",
    "home and lifestyle",
  ],
  category: "shopping",
  creator: site.name,
  publisher: site.name,
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { type: "website", siteName: site.name, locale: "en_NG", title: site.seoTitle, description: site.seoDescription },
  twitter: { card: "summary_large_image", title: site.seoTitle, description: site.seoDescription },
  // google-site-verification and msvalidate.01 meta tags from GOOGLE_SITE_VERIFICATION and
  // BING_SITE_VERIFICATION. Read when this module loads, so prerendered pages (the home page among
  // them) keep the value the build saw: yard-update passes both to the build (docs/SEO-AI.md).
  verification: siteVerification(),
}

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
  // Edge to edge on notched phones, so the env(safe-area-inset-*) paddings the home bar, sheets,
  // header and page body already carry take effect (without it they all read 0 and Safari
  // letterboxes the page in landscape).
  viewportFit: "cover",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Sidebar: apply the saved collapsed preference before first paint (no layout shift). */}
        <SidebarPrePaint />
        {/* Yard in plain language for AI assistants (llmstxt.org). Here rather than in metadata.alternates, which a page's own canonical replaces. */}
        <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
