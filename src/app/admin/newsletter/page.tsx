import type { Metadata } from "next"
import { NewsletterListView } from "@/components/admin/newsletter/newsletter-list"

export const metadata: Metadata = { title: "Newsletter" }

/** Admin › Newsletter (comms.newsletter): campaigns by status with their numbers. ?status= filters, ?campaign= opens one. */
export default function AdminNewsletterPage() {
  return <NewsletterListView />
}
