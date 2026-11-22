"use client"

import {
  FacebookLogoIcon,
  InstagramLogoIcon,
  LinkedinLogoIcon,
  SnapchatLogoIcon,
  ThreadsLogoIcon,
  TiktokLogoIcon,
  WhatsappLogoIcon,
  XLogoIcon,
  YoutubeLogoIcon,
  type Icon,
} from "@phosphor-icons/react"
import { site } from "@/config/site"
import type { YardSocial, YardSocialKey } from "@/lib/socials"
import { useYardSocials } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

const icons: Record<YardSocialKey, Icon> = {
  instagram: InstagramLogoIcon,
  tiktok: TiktokLogoIcon,
  x: XLogoIcon,
  youtube: YoutubeLogoIcon,
  threads: ThreadsLogoIcon,
  facebook: FacebookLogoIcon,
  snapchat: SnapchatLogoIcon,
  whatsapp: WhatsappLogoIcon,
  linkedin: LinkedinLogoIcon,
}

/**
 * Yard's own social profiles as a row of round icon links ("Yard on Instagram"), each opening in a
 * new tab with rel="me". The list comes from YARD_SOCIAL_* through /api/session, so it follows the
 * server's environment at request time on every page, static ones included; it renders nothing
 * until the session answers and nothing at all when no profile is configured.
 */
export function YardSocialLinks({ className, socials: given, title }: { className?: string; socials?: YardSocial[]; title?: string }) {
  const fromSession = useYardSocials()
  const socials = given ?? fromSession
  if (!socials.length) return null
  return (
    <div className={className}>
      {title ? <h2 className="mb-3 text-sm text-ink">{title}</h2> : null}
      <ul className="-mx-0.5 flex flex-wrap items-center gap-2" aria-label={`${site.name} on social media`}>
        {socials.map((s) => {
          const I = icons[s.key]
          return (
            <li key={s.key}>
              <a
                href={s.href}
                target="_blank"
                rel="me noopener"
                aria-label={`${site.name} on ${s.label} (opens in a new tab)`}
                title={`${site.name} on ${s.label}`}
                className={cn(
                  "press inline-flex size-10 items-center justify-center rounded-full border border-line-soft bg-elevated/60 text-ink-2 transition-colors",
                  "hover:border-line hover:bg-elevated hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid",
                )}
              >
                <I className="size-[18px]" weight="fill" aria-hidden />
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
