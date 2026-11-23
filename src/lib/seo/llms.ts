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
/** A brand with at least one public product; forSale false while a founding brand is opening soon (visible, not selling). */
export type LlmsBrand = { name: string; handle: string; oneLine: string | null; city: string | null; country: string | null; productCount: number; forSale: boolean }

/**
 * What checkout can do on this deployment (YARD_PAYMENTS): a named provider takes payment, "test"
 * takes none (a development or demo deployment), "soon" is closed (payments off).
 */
export type LlmsCheckout = "bachs" | "paystack" | "test" | "soon"

export type LlmsInput = {
  base: string
  name: string
  tagline: string
  description: string
  categories: LlmsCategory[]
  /**
   * The public catalogue (the /shop and sitemap rule: published, not hidden, of a listed and
   * launched brand, never a sample): its products, and the brands that have at least one of them.
   * openingSoon is the part of it from brands that are visible but not selling yet.
   */
  totals: { brands: number; products: number; openingSoon?: { brands: number; products: number } }
  checkout: LlmsCheckout
  /** llms-full.txt only. */
  brands?: LlmsBrand[]
  /** Yard's own social profiles (YARD_SOCIAL_*), in display order. */
  socials?: { label: string; href: string }[]
  generatedAt: string
}

const countryName = (code: string | null) => (code && code in countries ? countries[code as keyof typeof countries].name : code)

/** Markdown-safe inline text (link labels and list items): no brackets, no line breaks. */
const inline = (s: string) => plainText(s, 300).replace(/[[\]]/g, "")

function link(base: string, label: string, path: string, note?: string) {
  return `- [${inline(label)}](${absoluteUrl(base, path)})${note ? `: ${note}` : ""}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The catalogue in one or two sentences, from the public counts. */
function catalogueLine(input: LlmsInput, categoryNames: string[]) {
  const { name, totals } = input
  if (!totals.products) return `${name} is just opening: no products are listed yet. The catalogue grows as brands join.`
  const lines = [
    `Right now ${name} lists ${plural(totals.products, "product")} from ${plural(totals.brands, "brand")}${categoryNames.length ? `, across ${categoryNames.join(", ")}` : ""}. The catalogue grows as brands join; categories are not limited to any one kind of product.`,
  ]
  const soon = totals.openingSoon
  if (soon?.products) {
    const all = soon.products === totals.products
    lines.push(
      all
        ? `All of them are from ${soon.brands === 1 ? "a brand" : "brands"} opening soon on ${name}: the pieces can be browsed and the brands followed, but they are not on sale yet.`
        : `${soon.products} of these ${soon.products === 1 ? "product is" : "products are"} from ${plural(soon.brands, "brand")} opening soon on ${name}: those pieces can be browsed and the brands followed, but they are not on sale yet.`,
    )
  }
  return lines.join(" ")
}

/** The checkout bullet: only what this deployment can actually do. */
function checkoutLine(input: LlmsInput) {
  const prices = `Prices are set by each brand and shown in ${yardPolicies.pricesShownIn} unless stated otherwise`
  switch (input.checkout) {
    case "bachs":
    case "paystack":
      return `- Checkout: add pieces from one or more brands to one bag and pay once. Payment is by ${yardPolicies.paymentsBy[input.checkout]}. ${prices}; delivery costs are shown before you pay.`
    case "test":
      return `- Checkout: add pieces from one or more brands to one bag and pay once. This deployment's checkout runs in test mode and takes no real payment. ${prices}.`
    case "soon":
      return `- Checkout: opening soon. ${input.name} isn't taking payments yet, so nothing can be bought on ${input.name} today. Shoppers can browse every brand, keep pieces in their bag and follow brands to get notified of their drops and announcements; once checkout opens, one bag holds pieces from several brands and is paid for once. ${prices}.`
  }
}

export function llmsTxt(input: LlmsInput, full = false): string {
  const { base, name } = input
  const r = yardPolicies.returns
  const live = input.categories.filter((c) => c.productCount > 0)
  const categoryNames = (live.length ? live : input.categories).map((c) => c.name)
  const lines: string[] = [
    `# ${name}`,
    "",
    `> ${name} is an online marketplace for independent brands and limited drops: small studios and makers selling their own products directly, from fashion and streetwear to art, beauty, home goods and more. ${input.tagline}`,
    "",
    `${name} (${base.replace(/^https?:\/\//, "")}) is where people discover, follow and buy from independent brands of every kind. Every listing is sold by the brand that makes it, never by resellers. Shoppers browse by brand, category, city and limited drops, follow the brands they like, and ${input.checkout === "soon" ? "(once checkout opens) " : ""}check out once for pieces from several brands. ${name} launched in Nigeria; each brand chooses where it delivers, from its own country to international delivery zones.`,
    "",
    catalogueLine(input, categoryNames),
    "",
    `## Who it's for`,
    "",
    `- Shoppers who want something made by an independent brand rather than a mass-market label, and who like to buy early from new brands and limited drops.`,
    `- Independent brands that want a storefront, checkout, delivery estimates and payouts without building their own shop. Opening a store is free.`,
    "",
    `## How buying works`,
    "",
    checkoutLine(input),
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

  if (input.socials?.length) {
    lines.push(`## ${name} elsewhere`, "")
    for (const s of input.socials) lines.push(link(base, `${name} on ${s.label}`, s.href))
    lines.push("")
  }

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
      const facts = [where ? `Based in ${where}.` : "", `${plural(b.productCount, "product")} on ${name}.`, b.forSale ? "" : "Opening soon: not selling yet."].filter(Boolean).join(" ")
      lines.push(`${link(base, b.name, `/brands/${encodeURIComponent(b.handle)}`)}: ${[oneLine, facts].filter(Boolean).join(" ")}`)
    }
    lines.push("")
  } else {
    lines.push(`## Optional`, "", link(base, "llms-full.txt", "/llms-full.txt", "this guide plus every brand with products on Yard and each category with its product count"), "")
  }
  lines.push(`_Generated ${input.generatedAt} from ${name}'s live catalogue._`, "")
  return lines.join("\n")
}
