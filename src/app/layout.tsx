import type { Metadata, Viewport } from "next"
import { Providers } from "@/components/providers"
import { site } from "@/config/site"
import "./globals.css"

export const metadata: Metadata = {
  title: { default: `${site.name} — ${site.tagline}`, template: `%s — ${site.name}` },
  description: site.description,
}

export const viewport: Viewport = {
  themeColor: "#08080b",
  colorScheme: "dark",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
