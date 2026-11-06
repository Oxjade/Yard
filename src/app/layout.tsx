import type { Metadata, Viewport } from "next"
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
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem("nocturne-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}})()` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
