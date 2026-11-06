"use client"

import { useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { BrandMark } from "@/components/market/brand-mark"
import { Field, Segmented, control, inputClass } from "@/components/studio/catalog/fields"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Brand, BrandMark as BrandMarkType, ImageAsset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { encodeImage, uploadError } from "./image-tools"
import {
  ANNOUNCEMENT_MAX,
  INTRO_MAX,
  MARK_MAX,
  cleanHandle,
  cleanWebsite,
  isUpload,
  type EditorConfig,
  type FieldErrors,
  type SocialLinks,
} from "./model"
import { ControlGroup } from "./parts"
import { PhotoPicker } from "./photo-picker"

export type Update = (patch: Partial<EditorConfig> | ((c: EditorConfig) => Partial<EditorConfig>)) => void

const MARK_VALUE = "__mark__"

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={cn("text-xs tabular", n > max ? "text-danger" : "text-ink-3")}>{n}/{max}</span>
}

/** Turns a file into an image for the draft: an instant object-URL preview, then a durable data URL. */
function useUpload(kind: "cover" | "logo", apply: (image: ImageAsset, previewSrc?: string) => void) {
  const [busy, setBusy] = useState(false)
  async function run(file: File) {
    const problem = uploadError(file)
    if (problem) {
      toast.error("That file can't be used", { description: problem })
      return
    }
    setBusy(true)
    const preview = URL.createObjectURL(file)
    apply({ src: preview, alt: "", width: 1600, height: 1000 })
    try {
      const encoded = await encodeImage(file, kind === "cover" ? { max: 1600, type: "image/jpeg", quality: 0.8 } : { max: 400, type: "image/webp", quality: 0.9 })
      // No toast: the photo shows in the picker and the preview, and the logo's note says it isn't shown yet.
      apply({ src: encoded.src, alt: "", width: encoded.width, height: encoded.height }, preview)
    } catch {
      apply({ src: "", alt: "", width: 0, height: 0 }, preview)
      toast.error("We couldn't read that image", { description: "Try another file, or save it again as a JPG or PNG." })
    } finally {
      // The preview renders a deferred copy of the draft, so it can still ask for the instant
      // preview's URL a moment after the swap. Let it settle before the URL goes away.
      window.setTimeout(() => URL.revokeObjectURL(preview), 5000)
      setBusy(false)
    }
  }
  return { busy, run }
}

export function ContentControls({
  config,
  brand,
  photos,
  errors,
  onChange,
}: {
  config: EditorConfig
  brand: Brand
  photos: ImageAsset[]
  errors: FieldErrors
  onChange: Update
}) {
  /* ---- Cover ---- */
  const cover = config.cover ?? brand.cover
  const [coverUpload, setCoverUpload] = useState<ImageAsset | undefined>(isUpload(config.cover) ? config.cover : undefined)
  const coverUploader = useUpload("cover", (image, replacing) => {
    // An empty src means the upload failed: go back to the brand's cover.
    if (!image.src) {
      setCoverUpload(undefined)
      onChange((c) => (c.cover?.src === replacing ? { cover: undefined } : {}))
      return
    }
    setCoverUpload((prev) => ({ ...image, alt: prev && prev.src === replacing ? prev.alt : image.alt }))
    onChange((c) => {
      if (replacing && c.cover?.src !== replacing) return {}
      return { cover: { ...image, alt: replacing && c.cover?.src === replacing ? c.cover.alt : "" } }
    })
  })

  /* ---- Logo ---- */
  const mark: BrandMarkType = config.logo?.kind === "mark" ? config.logo.mark : brand.mark
  const logoValue = config.logo?.kind === "image" ? config.logo.image.src : MARK_VALUE
  const [logoUpload, setLogoUpload] = useState<ImageAsset | undefined>(config.logo?.kind === "image" && isUpload(config.logo.image) ? config.logo.image : undefined)
  const [lastMark, setLastMark] = useState<BrandMarkType>(mark)
  const logoUploader = useUpload("logo", (image, replacing) => {
    if (!image.src) {
      setLogoUpload(undefined)
      onChange((c) => (c.logo?.kind === "image" && c.logo.image.src === replacing ? { logo: { kind: "mark", mark: lastMark } } : {}))
      return
    }
    const alt = `${brand.name} logo`
    setLogoUpload({ ...image, alt })
    onChange((c) => {
      if (replacing && !(c.logo?.kind === "image" && c.logo.image.src === replacing)) return {}
      return { logo: { kind: "image", image: { ...image, alt } } }
    })
  })

  function setMark(next: Partial<BrandMarkType>) {
    const m = { ...mark, ...next }
    setLastMark(m)
    onChange({ logo: { kind: "mark", mark: m } })
  }

  /* ---- Announcement ---- */
  const announcement = config.announcement
  const [lastAnnouncement, setLastAnnouncement] = useState<{ text: string; href?: string }>(announcement ?? { text: "" })

  /* ---- Social ---- */
  const social: SocialLinks = config.social ?? brand.social
  function setSocial(key: keyof SocialLinks, value: string) {
    onChange((c) => ({ social: { ...(c.social ?? brand.social), [key]: value || undefined } }))
  }

  return (
    <>
      <ControlGroup
        id="sf-media"
        title="Logo and cover"
        description="Choose from your photos or upload from this computer. Your choice shows in the preview now and on your storefront once you publish. Image logos are saved, but storefronts show your text mark for now. Uploads are kept in this browser until media storage is connected."
      >
        <div className="grid gap-6">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p id="sf-cover-label" className="text-[13px] leading-none font-medium text-ink">Cover photo</p>
              {config.cover ? (
                <button type="button" className="rounded-sm text-xs text-violet hover:underline" onClick={() => onChange({ cover: undefined })}>
                  Use your brand cover
                </button>
              ) : null}
            </div>
            <figure className="relative aspect-[16/7] overflow-hidden rounded-md border border-line-soft bg-surface">
              {cover.src ? <Image src={cover.src} alt="" fill sizes="(min-width: 1024px) 340px, 100vw" className="object-cover" /> : null}
            </figure>
            <PhotoPicker
              id="sf-cover"
              labelledBy="sf-cover-label"
              photos={photos}
              value={cover.src}
              upload={coverUpload}
              uploading={coverUploader.busy}
              onUpload={coverUploader.run}
              onPick={(src) => {
                if (coverUpload && src === coverUpload.src) return onChange({ cover: coverUpload })
                const photo = photos.find((p) => p.src === src)
                if (photo) onChange({ cover: photo })
              }}
            />
            {isUpload(config.cover) ? (
              <Field id="sf-cover-alt" label="Describe the photo" error={errors["cover-alt"]} hint="Read aloud by screen readers. Say what's in the picture." className="mt-2">
                <Input
                  {...control("sf-cover-alt", errors["cover-alt"], true)}
                  value={config.cover?.alt ?? ""}
                  maxLength={160}
                  placeholder="Two models in washed black hoodies on a bridge at night"
                  className={inputClass}
                  onChange={(e) => {
                    const alt = e.target.value
                    setCoverUpload((u) => (u ? { ...u, alt } : u))
                    onChange((c) => (c.cover ? { cover: { ...c.cover, alt } } : {}))
                  }}
                />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-2">
            <p id="sf-logo-label" className="text-[13px] leading-none font-medium text-ink">Logo</p>
            <PhotoPicker
              id="sf-logo"
              labelledBy="sf-logo-label"
              photos={photos}
              initialCount={6}
              value={logoValue}
              upload={logoUpload}
              uploading={logoUploader.busy}
              onUpload={logoUploader.run}
              leading={{ value: MARK_VALUE, label: `Text mark, ${mark.text}`, node: <span className="absolute inset-0 flex items-center justify-center"><BrandMark brand={{ mark, name: brand.name }} size="md" /></span> }}
              onPick={(src) => {
                if (src === MARK_VALUE) return onChange({ logo: { kind: "mark", mark: lastMark } })
                if (logoUpload && src === logoUpload.src) return onChange({ logo: { kind: "image", image: logoUpload } })
                const photo = photos.find((p) => p.src === src)
                if (photo) onChange({ logo: { kind: "image", image: { ...photo, alt: `${brand.name} logo` } } })
              }}
            />

            <AnimatePresence initial={false} mode="popLayout">
              {config.logo?.kind === "image" ? (
                <motion.div key="image" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 flex items-center gap-3 rounded-md border border-line-soft bg-surface/50 p-3">
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-md border border-white/12 bg-obsidian">
                    {config.logo.image.src ? <Image src={config.logo.image.src} alt="" fill sizes="44px" className="object-cover" /> : null}
                  </span>
                  <p className="min-w-0 text-xs text-ink-2">
                    Saved with your draft. Storefronts show your text mark until image logos are switched on, so the preview keeps it too.
                  </p>
                </motion.div>
              ) : (
                <motion.div key="mark" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 grid gap-4">
                  <Field id="sf-mark-text" label="Mark" error={errors["mark-text"]} hint="One to three characters.">
                    <Input
                      {...control("sf-mark-text", errors["mark-text"], true)}
                      value={mark.text}
                      maxLength={MARK_MAX}
                      autoComplete="off"
                      className={cn(inputClass, "w-24 text-center tracking-wide")}
                      onChange={(e) => setMark({ text: e.target.value })}
                    />
                  </Field>
                  <fieldset className="grid min-w-0">
                    <legend className="mb-1.5 text-[13px] font-medium text-ink">Mark style</legend>
                    <Segmented
                      id="sf-mark-style"
                      label="Mark style"
                      value={mark.style}
                      onChange={(style) => setMark({ style })}
                      options={[
                        { value: "condensed", label: "Condensed" },
                        { value: "expanded", label: "Expanded" },
                        { value: "grotesk", label: "Grotesk" },
                      ]}
                    />
                  </fieldset>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </ControlGroup>

      <ControlGroup id="sf-introduction" title="Brand introduction" description="A few lines in your hero, under your tagline. Leave it empty to use your brand description.">
        <Field id="sf-intro" label="Introduction" error={errors.intro} aside={<Counter n={config.intro.length} max={INTRO_MAX} />}>
          <Textarea
            {...control("sf-intro", errors.intro)}
            value={config.intro}
            rows={4}
            placeholder={brand.description}
            className="min-h-28 resize-y"
            onChange={(e) => onChange({ intro: e.target.value })}
          />
        </Field>
      </ControlGroup>

      <ControlGroup
        id="sf-announcement"
        title="Announcement bar"
        description="A line across the top of your storefront, in your brand colour."
        action={
          <Switch
            id="sf-announcement"
            aria-label="Show an announcement bar"
            checked={!!announcement}
            onCheckedChange={(on) => {
              if (on) onChange({ announcement: lastAnnouncement })
              else {
                if (announcement) setLastAnnouncement(announcement)
                onChange({ announcement: null })
              }
            }}
          />
        }
      >
        <AnimatePresence initial={false} mode="popLayout">
          {announcement ? (
            <motion.div key="on" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-4">
              <Field id="sf-announcement-text" label="Message" error={errors["announcement-text"]} aside={<Counter n={announcement.text.length} max={ANNOUNCEMENT_MAX} />}>
                <Input
                  {...control("sf-announcement-text", errors["announcement-text"])}
                  value={announcement.text}
                  placeholder="e.g. Drop 08 lands Friday at 6pm"
                  className={inputClass}
                  onChange={(e) => {
                    const text = e.target.value
                    onChange((c) => ({ announcement: { ...(c.announcement ?? { text: "" }), text } }))
                  }}
                />
              </Field>
              <Field id="sf-announcement-href" label="Link" optional error={errors["announcement-href"]} hint="A page on the marketplace, like /drops, or a full https:// address.">
                <Input
                  {...control("sf-announcement-href", errors["announcement-href"], true)}
                  value={announcement.href ?? ""}
                  placeholder="/drops"
                  inputMode="url"
                  autoComplete="off"
                  className={inputClass}
                  onChange={(e) => {
                    const href = e.target.value
                    onChange((c) => ({ announcement: { text: c.announcement?.text ?? "", ...(href ? { href } : {}) } }))
                  }}
                  onBlur={(e) => {
                    const href = e.target.value.trim()
                    onChange((c) => ({ announcement: { text: c.announcement?.text ?? "", ...(href ? { href } : {}) } }))
                  }}
                />
              </Field>
            </motion.div>
          ) : (
            <motion.p key="off" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-ink-3">
              Off. Turn it on for a drop, a restock or a shipping note.
            </motion.p>
          )}
        </AnimatePresence>
      </ControlGroup>

      <ControlGroup
        id="sf-social"
        title="Social links"
        description="Shown in your storefront's hero once you publish. Leave a field empty to hide that link."
      >
        <div className="grid gap-4">
          {(
            [
              { key: "instagram", label: "Instagram", prefix: "instagram.com/", placeholder: "yourbrand" },
              { key: "tiktok", label: "TikTok", prefix: "tiktok.com/@", placeholder: "yourbrand" },
              { key: "x", label: "X", prefix: "x.com/", placeholder: "yourbrand" },
              { key: "website", label: "Website", prefix: "https://", placeholder: "yourbrand.com" },
            ] as const
          ).map((f) => {
            const id = `sf-social-${f.key}`
            const error = errors[f.key]
            return (
              <Field key={f.key} id={id} label={f.label} error={error}>
                <InputGroup className="h-11 rounded-md md:h-9">
                  <InputGroupAddon>
                    <InputGroupText className="text-xs font-normal text-ink-3">{f.prefix}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    {...control(id, error)}
                    value={social[f.key] ?? ""}
                    placeholder={f.placeholder}
                    inputMode={f.key === "website" ? "url" : "text"}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="h-full pl-0.5"
                    onChange={(e) => setSocial(f.key, e.target.value)}
                    onBlur={(e) => setSocial(f.key, f.key === "website" ? cleanWebsite(e.target.value) : cleanHandle(f.key, e.target.value))}
                  />
                </InputGroup>
              </Field>
            )
          })}
        </div>
      </ControlGroup>
    </>
  )
}
