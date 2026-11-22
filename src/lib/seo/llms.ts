/**
 * /llms.txt and /llms-full.txt (the llms.txt convention, llmstxt.org): a plain-language markdown
 * guide to Yard for AI assistants: what Yard is, who it's for, how buying works, and links to the
 * pages that answer the rest. The full version adds the live brands and the categories with their
 * product counts. Pure: the server passes the public facts in (src/server/seo/catalog.ts).
 *
 * Category-neutral on purpose: Yard's categories come from the data, never from this copy.
 */
import { countries } from "../../config/markets"
import { yardPolicies } from "./policies"
import { absoluteUrl, plainText } from "./url"

export type LlmsCategory = { slug: string; name: string; description: string; productCount: number; brandCount: number }
export type LlmsBrand = { name: string; handle: string; oneLine: string | null; city: string | null; country: string | null; productCount: number }

export type LlmsInput = {
  base: string
  name: string
  tagline: string
  description: string
  categories: LlmsCategory[]
  totals: { brands: number; products: number }
  /** llms-full.txt only. */
  brands?: LlmsBrand[]
  generatedAt: string
}

const countryName = (code: string | null) => (code && code in countries ? countries[code as keyof typeof countries].name : code)

/** Markdown-safe inline text (link labels and list items): no brackets, no line breaks. */
const inline = (s: string) => plainText(s, 300).replace(/[[\]]/g, "")

function link(base: string, label: string, path: string, note?: string) {
  return `- [${inline(label)}](${absoluteUrl(base, path)})${note ? `: ${note}` : ""}`
}

export function llmsTxt(input: LlmsInput, full = false): string {
  const { base, name } = input
  const r = yardPolicies.returns
  const live = input.categories.filter((c) => c.productCount > 0)
  const categoryNames = (live.length ? live : input.categories).map((c) => c.name)
  const lines: string[] = [
    `# ${name}`,
    "",
    `> ${name} is an online marketplace for independent brands: small studios and makers selling their own products directly. ${input.tagline}`,
    "",
    `${name} (${base.replace(/^https?:\/\//, "")}) is where people discover, follow and buy from independent brands. Every listing is sold by the brand that makes it, never by resellers. Shoppers browse by brand, category, city and limited drops, follow the brands they like, and check out once for pieces from several brands.`,
    "",
    `Right now ${name} lists ${input.totals.products} products from ${input.totals.brands} brands${categoryNames.length ? `, across ${categoryNames.join(", ")}` : ""}. The catalogue grows as brands join; categories are not limited to any one kind of product.`,
    "",
    `## Who it's for`,
    "",
    `- Shoppers who want something made by an independent brand rather than a mass-market label, and who like to buy early from new brands and limited drops.`,
    `- Independent brands that want a storefront, checkout, delivery estimates and payouts without building their own shop. Opening a store is free.`,
    "",
    `## How buying works`,
    "",
    `- Checkout: add pieces from one or more brands to one bag and pay once. Payment is by ${yardPolicies.payments}. Prices are set by each brand and shown in ${yardPolicies.pricesShownIn} unless stated otherwise; delivery costs are shown before you pay.`,
    `- Who sells: each brand is the seller of its own items; ${name} runs the marketplace, takes payment on the brand's behalf and helps when something goes wrong.`,
    `- Delivery: each brand dispatches its own orders. The product page and checkout show an estimated dispatch and arrival window from the brand's own handling time and delivery options. Estimates are not guarantees.`,
    `- Drops: a drop is a limited release that goes on sale at a set time; a draw picks buyers at random from entries. Rules, limits and opening times are on each drop's page.`,
    `- Returns: eligible items can be returned within ${r.days} days of delivery for orders delivered in ${r.countryName} (some brands allow longer). Refunds go back to the original payment method within ${r.refundDays[0]} to ${r.refundDays[1]} business days of approval. Orders delivered outside ${r.countryName} are final sale. Damaged, faulty or wrong items: report within ${yardPolicies.damagedReportHours} hours of delivery for a replacement or full refund.`,
    `- Cancellations: free until the brand dispatches the order.`,
    `- Help: message ${name} Support from the site, or email ${yardPolicies.supportEmail}. Replies within ${yardPolicies.supportReplyBusinessDays} business days.`,
    "",
    `## Key pages`,
    "",
    link(base, "Brands", "/brands", "every independent brand on Yard, with its city and storefront"),
    link(base, "Shop", "/shop", "the whole catalogue, filterable by brand, category, size, price, country and stock; search with ?q="),
    link(base, "Categories", "/categories", "browse by kind of product"),
    link(base, "Drops", "/drops", "live, upcoming and past limited releases"),
    link(base, "Charts", "/charts", "brands and drops moving on Yard: top, trending, emerging and city charts"),
    link(base, "Around", "/around", "brands, stores and showrooms on a map"),
    link(base, "Sell on Yard", "/sell", "how independent brands open a store"),
    link(base, "Support", "/support", "orders, delivery, returns, drops and accounts"),
    "",
    `## Policies`,
    "",
    link(base, "Returns and refunds", r.path, `${r.days}-day returns window, exclusions, refunds and cancellations`),
    link(base, "Terms", "/legal/terms", `${name}'s role, orders, payments, pricing, delivery, drops and draws`),
    link(base, "Privacy", "/legal/privacy"),
    link(base, "Seller agreement", "/legal/seller-agreement", "the terms for brands"),
    "",
    `## Machine-readable`,
    "",
    link(base, "Sitemap", "/sitemap.xml", "every public brand, product, category, collection and drop page"),
    link(base, "Product feed (RSS 2.0, Google Merchant Center format)", "/feeds/google.xml", "sellable products with price, availability, brand and delivery"),
    link(base, "Product feed (JSON)", "/feeds/products.json", "the same items as JSON"),
    "",
    `Product, brand and collection pages also carry schema.org JSON-LD (Product, Offer, Organization, ItemList, BreadcrumbList).`,
    "",
  ]

  if (full) {
    lines.push(`## Categories`, "")
    for (const c of input.categories) {
      const counts = `${c.productCount} ${c.productCount === 1 ? "product" : "products"} from ${c.brandCount} ${c.brandCount === 1 ? "brand" : "brands"}`
      lines.push(`${link(base, c.name, `/categories/${encodeURIComponent(c.slug)}`)}: ${counts}.${c.description ? ` ${inline(c.description)}` : ""}`)
    }
    lines.push("", `## Brands`, "")
    const brands = input.brands ?? []
    if (!brands.length) lines.push(`No brands are listed yet.`)
    for (const b of brands) {
      const where = [b.city, countryName(b.country)].filter(Boolean).join(", ")
      const oneLine = b.oneLine ? inline(b.oneLine).replace(/[.…]*$/, ".") : ""
      const facts = [where ? `Based in ${where}.` : "", `${b.productCount} ${b.productCount === 1 ? "product" : "products"} on Yard.`].filter(Boolean).join(" ")
      lines.push(`${link(base, b.name, `/brands/${encodeURIComponent(b.handle)}`)}: ${[oneLine, facts].filter(Boolean).join(" ")}`)
    }
    lines.push("")
  } else {
    lines.push(`## Optional`, "", link(base, "llms-full.txt", "/llms-full.txt", "this guide plus every live brand and each category with its product count"), "")
  }
  lines.push(`_Generated ${input.generatedAt} from ${name}'s live catalogue._`, "")
  return lines.join("\n")
}
