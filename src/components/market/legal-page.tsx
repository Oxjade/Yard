import type { ReactNode } from "react"
import Link from "next/link"

/** Yard's support address. Hard-coded: these pages are prerendered and never read the environment. */
export const SUPPORT_EMAIL = "support@yardstore.space"

/** The date shown on the support and legal pages. Change it by hand when their text changes. */
export const LEGAL_UPDATED = "13 November 2026"

/** The operator's details, for the owner to fill in. */
export const OPERATOR = "[Company legal name], [registered address], Lagos, Nigeria"

/**
 * The shared frame for /support and the /legal pages: the same column and type as
 * /legal/seller-agreement, with a heading, a "last updated" line and the sections.
 */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-28 pb-16 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">{title}</h1>
      <p className="mt-3 text-sm text-ink-3">Last updated: {LEGAL_UPDATED}</p>
      {intro ? <div className="mt-8 grid gap-4 text-[0.9375rem] leading-relaxed text-ink-2">{intro}</div> : null}
      <div className="mt-6 grid gap-10">{children}</div>
    </div>
  )
}

/** One numbered or titled section of a legal page. */
export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-lg text-ink">{title}</h2>
      <div className="mt-3 grid gap-4 text-[0.9375rem] leading-relaxed text-ink-2">{children}</div>
    </section>
  )
}

/** A list inside a section. */
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="grid list-disc gap-2 pl-5 marker:text-ink-3">{children}</ul>
}

/** An in-text link, styled like the seller agreement's. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  const className = "text-violet underline-offset-4 hover:underline"
  if (href.startsWith("mailto:") || href.startsWith("http")) {
    return <a href={href} className={className}>{children}</a>
  }
  return <Link href={href} className={className}>{children}</Link>
}

/** The support address as a mail link. */
export function SupportEmail() {
  return <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
}
