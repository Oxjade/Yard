"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { ArrowUpRightIcon, CopySimpleIcon, DotsThreeIcon, EyeIcon, EyeSlashIcon, ImagesSquareIcon, PencilSimpleIcon, PlayIcon, SortAscendingIcon, StarIcon, TagIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { coverOf } from "@/components/storefront/social/post-tile"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { ConfirmDialog } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAsyncAction } from "@/hooks/use-async-action"
import { isSafePermalink, providerLabels, type FeedSource, type StudioPostStatus, type StudioSocialPostDto } from "@/lib/api/contracts/social"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { bulkVisibility, deletePost, durationLabel, getStudioPosts, patchPost, studioPostsKey } from "@/lib/api/social"
import { cn } from "@/lib/utils"
import { CaptionSheet, FeaturedSheet, TagProductsSheet } from "./post-sheets"
import { can, cantSentence, missingNote, shortDate, sourceChip } from "./shared"
import { UploadSheet } from "./upload-sheet"

const statusMeta: Record<StudioPostStatus, { label: string; tab: string; tone: "success" | "muted" | "neutral" | "danger"; empty: string }> = {
  published: { label: "On storefront", tab: "On storefront", tone: "success", empty: "Nothing is on your storefront yet. Show posts from Hidden or upload new ones." },
  hidden: { label: "Hidden", tab: "Hidden", tone: "muted", empty: "No hidden posts." },
  draft: { label: "Draft", tab: "Drafts", tone: "neutral", empty: "No drafts." },
  removed: { label: "Removed by Yard", tab: "Removed by Yard", tone: "danger", empty: "Yard hasn't removed any of your posts." },
}

const statusOf = (p: StudioSocialPostDto): StudioPostStatus => (p.moderationStatus === "removed" ? "removed" : p.visibility)

function GridSkeleton() {
  return (
    <ul aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <Bone className="aspect-square w-full rounded-none" />
          <div className="grid gap-2 p-3">
            <Bone className="h-3 w-1/3" />
            <Bone className="h-3 w-5/6" />
            <Bone className="h-5 w-24" />
          </div>
        </li>
      ))}
    </ul>
  )
}

type Act = (post: StudioSocialPostDto) => void

/** One post in Content Studio: media, source chip, date, two caption lines, status, and the post's menu. */
function Tile({
  post,
  selected,
  mayPublish,
  onSelect,
  onPatch,
  onTag,
  onCaption,
  onDelete,
}: {
  post: StudioSocialPostDto
  selected: boolean
  mayPublish: boolean
  onSelect: (on: boolean) => void
  onPatch: (post: StudioSocialPostDto, body: Parameters<typeof patchPost>[1], done: string) => void
  onTag: Act
  onCaption: Act
  onDelete: Act
}) {
  const status = statusOf(post)
  const meta = statusMeta[status]
  const cover = coverOf(post)
  const removed = status === "removed"
  const video = post.media[0]?.kind === "video"
  const duration = video ? durationLabel(post.media[0]?.durationMs) : null
  const upload = post.source === "upload"
  const missing = missingNote(post)
  const permalink = isSafePermalink(post.permalink) ? post.permalink : null
  const net = post.provider ? providerLabels[post.provider] : "Instagram"
  // A removed upload can only be deleted; a removed import has nothing left to do.
  const menu = mayPublish && (!removed || upload)
  return (
    <li className="min-w-0">
      <figure className={cn("group relative h-full overflow-hidden rounded-lg border bg-card transition-colors", selected ? "border-purple" : "border-line-soft")}>
        <div className="relative aspect-square bg-surface">
          <Image src={cover.src} alt={cover.alt} fill unoptimized sizes="(min-width: 1024px) 22vw, 50vw" className={cn("object-cover", (removed || status !== "published") && "opacity-70")} />
          {!removed && mayPublish ? (
            <label className="absolute top-1 left-1 inline-flex size-10 cursor-pointer items-center justify-center rounded-md" aria-label={`Select post from ${shortDate(post.postedAt)}`}>
              <span className="inline-flex size-6 items-center justify-center rounded-[5px] bg-obsidian/80">
                <Checkbox checked={selected} onCheckedChange={(c) => onSelect(c === true)} />
              </span>
            </label>
          ) : null}
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-[4px] bg-obsidian/80 px-1.5 py-0.5 text-[11px] text-ink">
            {post.kind === "carousel" ? <CopySimpleIcon className="size-3" aria-hidden /> : null}
            {sourceChip(post)}
          </span>
          {post.featured && !removed ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-[4px] bg-obsidian/80 px-1.5 py-0.5 text-[11px] text-ink">
              <StarIcon weight="fill" className="size-3 text-ink" aria-hidden /> Featured
            </span>
          ) : null}
          {video ? (
            <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-[4px] bg-obsidian/80 px-1.5 py-0.5 text-[11px] text-ink tabular">
              <PlayIcon weight="fill" className="size-3" aria-hidden />
              {duration ?? "Video"}
            </span>
          ) : null}
        </div>
        <figcaption className="grid gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-ink-3 tabular">{shortDate(post.postedAt)}</p>
            {menu ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="-my-2 -mr-2 size-10 md:size-8" aria-label={`Actions for the post from ${shortDate(post.postedAt)}`}>
                    <DotsThreeIcon weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {!removed ? (
                    <>
                      {status === "published" ? (
                        <DropdownMenuItem onSelect={() => onPatch(post, { visibility: "hidden" }, "Hidden from your storefront")}>
                          <EyeSlashIcon aria-hidden /> Hide
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => onPatch(post, { visibility: "published" }, "Shown on your storefront")}>
                          <EyeIcon aria-hidden /> Show on storefront
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => onPatch(post, { featured: !post.featured }, post.featured ? "No longer featured" : "Featured: it leads your feed")}>
                        <StarIcon weight={post.featured ? "fill" : "regular"} aria-hidden /> {post.featured ? "Unfeature" : "Feature"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onTag(post)}>
                        <TagIcon aria-hidden /> Tag products
                      </DropdownMenuItem>
                      {upload ? (
                        <DropdownMenuItem onSelect={() => onCaption(post)}>
                          <PencilSimpleIcon aria-hidden /> Edit caption
                        </DropdownMenuItem>
                      ) : null}
                      {permalink ? (
                        <DropdownMenuItem asChild>
                          <a href={permalink} target="_blank" rel="noopener noreferrer">
                            <ArrowUpRightIcon aria-hidden /> View original
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  ) : null}
                  {upload ? (
                    <>
                      {!removed ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(post)}>
                        <TrashIcon aria-hidden /> Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <p className={cn("line-clamp-2 min-h-[2lh] text-[13px]", post.caption ? "text-ink" : "text-ink-3")}>{post.caption || "No caption"}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {post.productIds.length ? <span className="text-[11px] text-ink-3">{post.productIds.length === 1 ? "1 piece tagged" : `${post.productIds.length} pieces tagged`}</span> : null}
          </div>
          {removed && post.removedReason ? <p className="text-xs text-danger">Reason: {post.removedReason}</p> : null}
          {removed && !upload ? <p className="text-xs text-ink-3">Imported posts Yard removed stay listed here.</p> : null}
          {missing ? (
            <p className="inline-flex items-center gap-1 text-xs text-ink-2">
              <WarningCircleIcon className="size-3.5 text-ink-3" aria-hidden /> {missing}
            </p>
          ) : null}
          {post.source === "sandbox" ? <p className="text-[11px] text-ink-3">Sandbox post, not from {net}.</p> : null}
        </figcaption>
      </figure>
    </li>
  )
}

/**
 * Content Studio (§6.1): every post of the active brand, by source and status, with Show/Hide,
 * Feature, Tag products, Edit caption and Delete (uploads), bulk Show/Hide, Arrange featured, and
 * the upload sheet. A post Yard removed is locked: it shows the reason and offers only Delete
 * (uploads).
 */
export function ContentStudio({
  brand,
  source,
  onSourceChange,
  uploadOpen,
  onUploadOpenChange,
  anyConnected,
  onChanged,
}: {
  brand: BrandProfile
  source: FeedSource
  onSourceChange: (s: FeedSource) => void
  uploadOpen: boolean
  onUploadOpenChange: (o: boolean) => void
  anyConnected: boolean
  onChanged: () => void
}) {
  const key = studioPostsKey(source, "all")
  const { data, error, isLoading, mutate, revalidate } = useApi(key, getStudioPosts)
  const [status, setStatus] = useState<StudioPostStatus>("published")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tagging, setTagging] = useState<StudioSocialPostDto | null>(null)
  const [captioning, setCaptioning] = useState<StudioSocialPostDto | null>(null)
  const [deleting, setDeleting] = useState<StudioSocialPostDto | null>(null)
  const [arranging, setArranging] = useState(false)
  const mayPublish = can(brand, "content.publish")
  const posts = useMemo(() => data?.posts ?? [], [data])
  const shown = posts.filter((p) => statusOf(p) === status)
  const featured = posts.filter((p) => p.featured && p.moderationStatus !== "removed")
  const selectedIds = [...selected].filter((id) => posts.some((p) => p.id === id && statusOf(p) !== "removed"))

  const replace = (next: StudioSocialPostDto[]) =>
    mutate((cur) => {
      if (!cur) return cur
      const byId = new Map(next.map((p) => [p.id, p]))
      return { ...cur, posts: cur.posts.map((p) => byId.get(p.id) ?? p) }
    })
  const refresh = () => {
    void revalidate()
    onChanged()
  }

  async function onPatch(post: StudioSocialPostDto, body: Parameters<typeof patchPost>[1], done: string) {
    try {
      const r = await patchPost(post.id, body)
      replace([r.post])
      toast.success(done)
      refresh()
    } catch (e) {
      toast.error("That didn't save", { description: errorMessage(e) })
      refresh()
    }
  }

  const bulk = useAsyncAction((visibility: "published" | "hidden") => bulkVisibility(selectedIds, visibility), {
    success: (r) => `${r.posts.length === 1 ? "1 post" : `${r.posts.length} posts`} updated`,
    error: "Couldn't update those posts. Try again.",
    onSuccess: (r) => {
      replace(r.posts)
      setSelected(new Set())
      refresh()
    },
  })

  const remove = useAsyncAction((post: StudioSocialPostDto) => deletePost(post.id), {
    success: "Post deleted",
    error: "Couldn't delete the post. Try again.",
    onSuccess: () => refresh(),
  })

  const counts = data?.counts
  const tabs = (Object.keys(statusMeta) as StudioPostStatus[]).map((s) => ({ value: s, label: statusMeta[s].tab, count: counts?.[s] }))
  const nothingAtAll = !!data && posts.length === 0 && source === "all"

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<FeedSource>
          label="Source"
          value={source}
          onChange={(s) => {
            onSourceChange(s)
            setSelected(new Set())
          }}
          options={[
            { value: "all", label: "All" },
            { value: "instagram", label: "Instagram" },
            { value: "tiktok", label: "TikTok" },
            { value: "uploads", label: "Uploads" },
          ]}
          className="max-w-full overflow-x-auto"
        />
        <div className="flex flex-wrap items-center gap-2">
          {featured.length > 1 && mayPublish ? (
            <Button variant="secondary" onClick={() => setArranging(true)}>
              <SortAscendingIcon aria-hidden /> Arrange featured
            </Button>
          ) : null}
          <Button variant="primary" disabled={!mayPublish} onClick={() => onUploadOpenChange(true)} aria-describedby={!mayPublish ? "content-cant" : undefined}>
            <UploadSimpleIcon aria-hidden /> Upload
          </Button>
        </div>
      </div>
      {!mayPublish ? (
        <p id="content-cant" className="text-xs text-ink-2">
          {cantSentence(brand, "content.publish")} You can still see every post.
        </p>
      ) : null}

      <StatusTabs id="content-status" label="Post status" value={status} onChange={setStatus} tabs={tabs} controls="content-grid" />

      <div id="content-grid" role="tabpanel" aria-labelledby={`content-status-${status}`}>
        {isLoading ? (
          <div role="status">
            <span className="sr-only">Loading your posts</span>
            <GridSkeleton />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-line-soft px-6 py-10 text-center">
            <p className="text-sm text-ink">Couldn&apos;t load your posts.</p>
            <p className="text-xs text-ink-2">{errorMessage(error, "Check your connection, then try again.")}</p>
            <Button variant="secondary" onClick={() => void revalidate()}>
              Retry
            </Button>
          </div>
        ) : nothingAtAll ? (
          <EmptyState
            icon={ImagesSquareIcon}
            title="Nothing here yet"
            body={anyConnected ? "Your connected accounts have no posts yet. Upload photos and videos to Yard, or sync again later." : "Connect Instagram or TikTok, or upload photos and videos to Yard."}
            action={
              mayPublish ? (
                <Button variant="primary" onClick={() => onUploadOpenChange(true)}>
                  <UploadSimpleIcon aria-hidden /> Upload
                </Button>
              ) : undefined
            }
          />
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-ink-2">{source === "all" ? statusMeta[status].empty : `${statusMeta[status].empty.replace(/\.$/, "")} from ${source === "uploads" ? "uploads" : providerLabels[source]}.`}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            {shown.map((p) => (
              <Tile
                key={p.id}
                post={p}
                selected={selected.has(p.id)}
                mayPublish={mayPublish}
                onSelect={(on) =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (on) next.add(p.id)
                    else next.delete(p.id)
                    return next
                  })
                }
                onPatch={(post, body, done) => void onPatch(post, body, done)}
                onTag={setTagging}
                onCaption={setCaptioning}
                onDelete={setDeleting}
              />
            ))}
          </ul>
        )}
      </div>

      {selectedIds.length ? (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-1 pb-[env(safe-area-inset-bottom)]">
          <div data-toast-avoid="" role="region" aria-label="Selected posts" className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-elevated px-3 py-2">
            <span className="px-1 text-sm text-ink tabular">{selectedIds.length} selected</span>
            <Button variant="secondary" size="sm" className="h-10 md:h-8" loading={bulk.pending} onClick={() => void bulk.run("published")}>
              <EyeIcon aria-hidden /> Show
            </Button>
            <Button variant="secondary" size="sm" className="h-10 md:h-8" disabled={bulk.pending} onClick={() => void bulk.run("hidden")}>
              <EyeSlashIcon aria-hidden /> Hide
            </Button>
            <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <UploadSheet open={uploadOpen} onOpenChange={onUploadOpenChange} brandId={brand.brand.id} onPosted={refresh} />
      <TagProductsSheet post={tagging} brandId={brand.brand.id} onClose={() => setTagging(null)} onSaved={(p) => (replace([p]), refresh())} />
      <CaptionSheet post={captioning} onClose={() => setCaptioning(null)} onSaved={(p) => (replace([p]), refresh())} />
      <FeaturedSheet open={arranging} posts={featured} onOpenChange={setArranging} onSaved={refresh} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this post?"
        body="It leaves your storefront and Content Studio. Its files are deleted from Yard within 7 days."
        confirmLabel="Delete post"
        onConfirm={() => {
          if (deleting) void remove.run(deleting)
        }}
      />
    </div>
  )
}
