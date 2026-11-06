import type { Metadata, Viewport } from "next"
import { SidebarPrePaint } from "@/components/dashboard/shell/sidebar-pre-paint"
import { Providers } from "@/components/providers"
import { site } from "@/config/site"
import "./globals.css"

export const metadata: Metadata = {
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
