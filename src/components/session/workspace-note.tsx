"use client"

import { InfoIcon } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * A quiet top-bar note about whose data the legacy (browser-store) pages show, next to the demo
 * session the new server pages use (§2.3): the sentence from xl, an info button with the same
 * sentence below that. Studio uses it when the session brand isn't the browser's sample brand;
 * Admin when the session admin isn't Kemi Ajayi, whom the legacy pages act as.
 */
export function WorkspaceNote({ text, label }: { text: string; /** The info button's accessible name. */ label: string }) {
  return (
    <>
      <p data-workspace-note className="hidden max-w-[22rem] text-[12px] leading-snug text-ink-3 xl:block">
        {text}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-workspace-note
            aria-label={label}
            className="inline-flex size-10 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink xl:hidden"
          >
            <InfoIcon aria-hidden className="size-[18px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] text-[13px] leading-snug text-ink-2">
          {text}
        </PopoverContent>
      </Popover>
    </>
  )
}
