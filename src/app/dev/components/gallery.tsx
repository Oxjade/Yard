"use client"

import { useState } from "react"
import { FlagIcon, UserSwitchIcon } from "@phosphor-icons/react"
import { AuthPrompt } from "@/components/market/auth-prompt"
import { MediaUploader, UploadRow, type UploadItem } from "@/components/media/media-uploader"
import { ReportSheet } from "@/components/report/report-sheet"
import { DemoAccountPicker } from "@/components/session/demo-account-picker"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { SessionGate } from "@/components/session/session-gate"
import { Button } from "@/components/ui/button"
import { SampleChip } from "@/components/ui/sample-chip"
import { Toaster } from "@/components/ui/sonner"
import { ApiError } from "@/lib/api/client"
import { REPORT_REASONS, reportReasonLabels, reportSubjectLabels, type ReportSubject } from "@/lib/api/contracts/reports"
import { useServerSession } from "@/lib/session/use-server-session"

const subjects = Object.keys(REPORT_REASONS) as ReportSubject[]

const staticRows: UploadItem[] = [
  { key: "a", name: "fit-check-mirror.jpg", size: 2_340_000, kind: "image", state: "uploading", progress: 0.45 },
  { key: "b", name: "IMG_2041.HEIC", size: 3_100_000, kind: "image", state: "error", progress: 0, error: "This is a HEIC photo. Export it as JPEG and try again." },
  { key: "c", name: "lookbook-07.jpg", size: 880_000, kind: "image", state: "done", progress: 1 },
]

/** A stubbed request: the server refusing the file, through the uploader's real error path. Nothing is uploaded. */
const refuse = () => ({ promise: Promise.reject(new ApiError(415, "unsupported_type", "Unsupported")), abort: () => {} })
/** A stubbed request that can't reach the server (retryable). Nothing is uploaded. */
const offline = () => ({ promise: Promise.reject(new TypeError("Failed to fetch")), abort: () => {} })

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-line-soft bg-surface p-4 md:p-6">
      <div>
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        {note ? <p className="mt-1 text-[13px] text-ink-2">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function DevGallery() {
  // The sheet stays mounted once opened (as a thread or post menu keeps it), so reopening it, or
  // reusing it for another subject, shows how it resets.
  const [report, setReport] = useState<ReportSubject | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [picker, setPicker] = useState<"studio" | "admin" | null>(null)
  const session = useServerSession()

  return (
    <div id="main" className="mx-auto grid max-w-5xl gap-6 px-4 pt-10 pb-24 md:px-8">
      <header>
        <p className="text-[12px] text-ink-3">Development only</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink">Shared v2 components</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">The pieces every v2 feature reuses. Session: {session.status === "ready" ? `shopper ${session.shopper?.name ?? "signed out"}, brand ${session.brand?.name ?? "signed out"}, admin ${session.admin?.name ?? "signed out"}` : session.status}.</p>
      </header>

      <Section title="SampleChip" note="Marks anything that comes from sample data in the marketplace.">
        <div className="flex flex-wrap items-center gap-3">
          <SampleChip />
          <SampleChip label="Includes sample activity" />
          <SampleChip label="Sample place" />
        </div>
      </Section>

      <Section title="ReportSheet" note="Each subject type's reasons. Opening one uses the real POST /api/reports; the demo subjects don't exist, so a send shows the “may have been removed” state.">
        <div className="grid gap-3 md:grid-cols-2">
          {subjects.map((s) => (
            <div key={s} className="grid gap-2 rounded-lg border border-line-soft bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-ink">Report {/^[aeiou]/.test(reportSubjectLabels[s]) ? "an" : "a"} {reportSubjectLabels[s]}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setReport(s)
                    setReportOpen(true)
                  }}
                  data-report-open={s}
                >
                  <FlagIcon aria-hidden /> Open
                </Button>
              </div>
              <ul className="grid gap-0.5 text-[12px] text-ink-2">
                {REPORT_REASONS[s].map((r) => (
                  <li key={r}>{reportReasonLabels[r]?.label ?? r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {report ? <ReportSheet open={reportOpen} onOpenChange={setReportOpen} subjectType={report} subjectId={`demo_${report}`} as="shopper" /> : null}
      </Section>

      <Section title="MediaUploader" note="Live control below (uploads go to POST /api/uploads, built by F2). The rows under it are static states for review: nothing is uploading.">
        <MediaUploader purpose="inbox_attachment" as="shopper" brandId="b_lagos_static" />
        <div className="grid gap-2">
          <p className="text-[12px] text-ink-3">Static states: uploading at 45 %, an error, done.</p>
          <ul className="grid gap-2">
            {staticRows.map((r) => (
              <UploadRow key={r.key} item={r} />
            ))}
          </ul>
        </div>
        <div className="grid gap-2">
          <p className="text-[12px] text-ink-3">With a stubbed request that the server refuses (415): choose a JPEG to see the error path.</p>
          <MediaUploader purpose="social_post" as="brand" allowVideo uploader={refuse} />
        </div>
        <div className="grid gap-2">
          <p className="text-[12px] text-ink-3">Four attachments at most, with a stubbed request that can&apos;t reach the server: failed files keep their place until removed.</p>
          <MediaUploader purpose="inbox_attachment" as="shopper" maxFiles={4} uploader={offline} />
        </div>
        <MediaUploader purpose="location_image" as="brand" disabled disabledReason="Your role (Viewer) can't manage locations." />
      </Section>

      <Section title="SessionGate" note="Real states for the Studio session: loading, signed out (demo sign-in), missing permission, or the page.">
        <SessionGate surface="studio" permission="social.connect" feature="Social">
          <p className="rounded-lg border border-line-soft bg-card p-4 text-sm text-ink">Signed in with permission: this is where the page renders.</p>
        </SessionGate>
      </Section>

      <Section title="DemoAccountPicker" note="Signs in as a demo account on the server (the previous session of that kind ends first).">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPicker("studio")}>
            <UserSwitchIcon aria-hidden /> Studio accounts
          </Button>
          <Button variant="secondary" onClick={() => setPicker("admin")}>
            <UserSwitchIcon aria-hidden /> Admin accounts
          </Button>
        </div>
        {picker ? <DemoAccountPicker surface={picker} open={!!picker} onOpenChange={(o) => !o && setPicker(null)} /> : null}
      </Section>

      <Section title="DemoAuthBanner" note="Shown on every surface only in production with YARD_DEMO_AUTH on. Preview:">
        <DemoAuthBanner placement="shell" preview />
      </Section>
      {/* This page sits outside the surface layouts: the prompt and toasts the components use. */}
      <AuthPrompt />
      <Toaster tone="calm" />
    </div>
  )
}
