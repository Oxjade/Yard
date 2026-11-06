import Link from "next/link"
import { ArrowUpRightIcon, LightbulbIcon } from "@phosphor-icons/react/ssr"
import { cn } from "@/lib/utils"

/**
 * Until its data is known, text renders as its own placeholder: the same words in the same
 * box, transparent, with a bar behind each line. Height and line breaks are therefore
 * exactly the real ones, so nothing moves when the real text arrives. Hidden from assistive
 * technology and not selectable.
 */
function Placeholder({ as: Tag = "div", className, children }: { as?: "div" | "p"; className?: string; children: React.ReactNode }) {
  return (
    <Tag aria-hidden className={cn(className, "select-none text-transparent [&_*]:border-transparent")}>
      <span className="rounded-md bg-obsidian/10 box-decoration-clone">{children}</span>
    </Tag>
  )
}

/**
 * The one acid card on a dashboard: a finding from the page's own data in big type, the
 * facts behind it, and the action that addresses it.
 */
export function InsightCard({
  pill = "Insight",
  title,
  body,
  facts,
  action,
  media,
  ready = true,
  titleReady = ready,
  className,
}: {
  pill?: string
  /** A picture of the record the insight is about (a product photo), shown top right. */
  media?: React.ReactNode
  title: React.ReactNode
  body?: React.ReactNode
  facts?: { label: string; value: React.ReactNode }[]
  action: { href: string; label: string }
  /** False until the body and facts are known: same-size placeholders stand in. */
  ready?: boolean
  /** False until the title is known. Defaults to `ready`; pass true when the title comes from static data. */
  titleReady?: boolean
  className?: string
}) {
  return (
    <article className={cn("relative flex min-w-0 flex-col rounded-[20px] bg-acid p-4 text-obsidian md:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-obsidian px-3 text-[12px] font-medium text-acid">
          <LightbulbIcon weight="fill" aria-hidden className="size-3.5" />
          {pill}
        </span>
        {media ? <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl bg-obsidian/10 ring-1 ring-obsidian/15">{media}</span> : null}
      </div>
      {titleReady ? <h2 className={titleClass}>{title}</h2> : <Placeholder className={titleClass}>{title}</Placeholder>}
      {body ? ready ? <p className={bodyClass}>{body}</p> : <Placeholder as="p" className={bodyClass}>{body}</Placeholder> : null}
      <div className="mt-auto pt-6">
        {facts?.length ? (
          <dl className="mb-5 grid grid-cols-2 gap-3 border-t border-obsidian/15 pt-4">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="truncate text-[11px] text-obsidian/60">{f.label}</dt>
                <dd className="font-metric mt-1.5 text-[1.5rem] text-obsidian">{ready ? f.value : <Placeholder>{f.value}</Placeholder>}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <Link
          href={action.href}
          className="group/ins inline-flex h-10 items-center gap-2 rounded-full bg-obsidian pr-2 pl-4 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-obsidian/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-obsidian"
        >
          {action.label}
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-acid text-obsidian">
            <ArrowUpRightIcon aria-hidden className="size-3.5 transition-transform duration-200 ease-out-quint group-hover/ins:translate-x-px group-hover/ins:-translate-y-px" />
          </span>
        </Link>
      </div>
    </article>
  )
}

const titleClass = "mt-4 text-[1.375rem] leading-[1.25] font-medium tracking-[-0.012em] text-balance md:text-[1.5rem]"
const bodyClass = "mt-3 max-w-md text-[13px] leading-relaxed text-obsidian/75"

/** Wraps the key figure in an insight title in an outlined pill. */
export function InsightEmphasis({ children }: { children: React.ReactNode }) {
  return <span className="mx-0.5 inline-flex items-center rounded-full border-[1.5px] border-obsidian px-2 leading-[1.2] font-semibold whitespace-nowrap tabular">{children}</span>
}
