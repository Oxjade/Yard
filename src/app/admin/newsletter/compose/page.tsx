import type { Metadata } from "next"
import { NewsletterComposeRoute } from "@/components/admin/newsletter/newsletter-composer"

export const metadata: Metadata = { title: "Compose newsletter" }

/** Admin › Newsletter › Compose (?id=<campaign>): the draft composer with the live email preview. */
export default function AdminNewsletterComposePage() {
  return <NewsletterComposeRoute />
}
