import Link from "next/link"
import type { Brand, Category, Product } from "@/lib/data/types"

/** Shop / Category / Brand, then the product itself on wider screens. */
export function ProductBreadcrumb({ product, category, brand }: { product: Product; category: Category; brand: Brand }) {
  const crumbs = [
    { href: "/shop", label: "Shop" },
    { href: `/categories/${category.slug}`, label: category.name },
    { href: `/brands/${brand.handle}`, label: brand.name },
  ]
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden className="text-ink-3">
                /
              </span>
            ) : null}
            <Link href={c.href} className="-my-2 inline-flex min-h-10 items-center rounded-md transition-colors duration-150 hover:text-ink">
              {c.label}
            </Link>
          </li>
        ))}
        <li className="hidden min-w-0 items-center gap-2 md:flex">
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <span aria-current="page" className="truncate text-ink">
            {product.name}
          </span>
        </li>
      </ol>
    </nav>
  )
}
