import { AuthPrompt } from "@/components/market/auth-prompt"
import { FooterChrome, HeaderChrome, TabbarChrome } from "@/components/market/focused-chrome"
import { BagDrawer } from "@/components/market/bag-drawer"
import { MarketFooter } from "@/components/market/market-footer"
import { MobileTabBar } from "@/components/market/mobile-tabbar"
import { SearchOverlay } from "@/components/market/search-overlay"
import { Toaster } from "@/components/ui/sonner"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { RealtimeProvider } from "@/lib/realtime/provider"
import { SessionSync } from "@/lib/session/session-sync"

/** The customer marketplace shell: floating nav, the phone home bar, the cart drawer, search. Checkout gets a focused header instead. */
export default function MarketLayout({ children }: LayoutProps<"/">) {
  return (
    <RealtimeProvider surface="market">
      <div data-surface="market" className="relative min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-acid focus:px-3 focus:py-2 focus:text-obsidian">
          Skip to content
        </a>
        {/* Each piece of chrome follows the route's mode (chromeFor, §7.2): checkout gets its
            focused header and no home bar; /around a solid bar (desktop) or the map header
            (phones) and no footer; the Inbox no footer. */}
        <HeaderChrome />
        <DemoAuthBanner placement="market" />
        <main id="main">{children}</main>
        <FooterChrome>
          <MarketFooter />
        </FooterChrome>
        <TabbarChrome>
          <MobileTabBar />
        </TabbarChrome>
        <BagDrawer />
        <SearchOverlay />
        <AuthPrompt />
        <SessionSync />
        <Toaster tone="comic" />
      </div>
    </RealtimeProvider>
  )
}
