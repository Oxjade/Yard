import type { Metadata } from "next"
import Link from "next/link"
import { LockKeyIcon } from "@phosphor-icons/react/ssr"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "No access", robots: { index: false, follow: false } }

/**
 * What a Control Center admin sees in place of a section their role doesn't hold
 * (src/lib/admin-sections.ts). src/proxy.ts rewrites the section's address here before it renders,
 * so none of its data is requested; the address bar keeps the section's URL. Static.
 */
export default function AdminNoAccessPage() {
  return (
    <EmptyState
      icon={LockKeyIcon}
      title="You don't have access to this"
      body="Your role doesn't include this part of the Control Center. If you need it for your work, ask an owner to change your role."
      action={
        <Button asChild variant="secondary">
          <Link href="/admin">Back to the overview</Link>
        </Button>
      }
    />
  )
}
