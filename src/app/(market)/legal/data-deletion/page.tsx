import type { Metadata } from "next"
import { Suspense } from "react"
import { LegalLink, LegalList, LegalPage, LegalSection, SupportEmail } from "@/components/market/legal-page"
import { DataDeletionStatus } from "./status"

export const metadata: Metadata = {
  title: "Data deletion",
  description: "How to delete your Yard account and personal data, what is deleted and when, and how to check an Instagram data deletion request.",
  alternates: { canonical: "/legal/data-deletion" },
}

/**
 * /legal/data-deletion: how to delete your Yard account and data (the apps open it as
 * ?view=app). With ?code= (§6.1) it is also the status page Meta links people to after an
 * Instagram data-deletion request: the request's status shows at the top, "Received" or
 * "Completed" only, no account or brand details. The page itself is static HTML; only the status
 * card waits for the code, so the page never depends on JavaScript to show.
 */
export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data deletion"
      intro={
        <>
          <Suspense fallback={null}>
            <DataDeletionStatus />
          </Suspense>
          <p>You can ask Yard to close your account and delete your personal data at any time. This page explains how, what is deleted, what we have to keep, and how long it takes.</p>
        </>
      }
    >
      <LegalSection title="How to delete your account">
        <p>
          Email <SupportEmail /> from the address on your Yard account and ask us to delete your account. We may ask you to confirm it&apos;s you. We will confirm by email when your account is closed, and we respond to every request within 30 days.
        </p>
        <p>If you own a brand on Yard, hand the brand over to another owner (or ask us to close it) before your account can be deleted.</p>
      </LegalSection>

      <LegalSection title="What is deleted">
        <LegalList>
          <li>As soon as your request is processed you are signed out everywhere, and nobody can sign in to the account again: your password and any Google, Facebook or Apple sign-in links are removed.</li>
          <li>Your name, email address, city, country and profile photo are deleted or anonymised, together with your follows, wishlist, drop reminders and notifications.</li>
          <li>Personal data in your orders and payments, such as your name, phone number and delivery address, is anonymised.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="What we keep, and for how long">
        <LegalList>
          <li>Order, payment and tax records, without your personal details: for 6 years after the transaction, as Nigerian tax and accounting law requires.</li>
          <li>Messages and support requests: for up to 2 years after the last message, or longer if needed for a dispute.</li>
          <li>Security logs: generally for up to 12 months.</li>
        </LegalList>
        <p>
          Everything else is deleted or anonymised within 90 days after your account is closed. Our <LegalLink href="/legal/privacy">Privacy policy</LegalLink> has the details.
        </p>
      </LegalSection>

      <LegalSection title="Instagram">
        <p>
          If a brand connected Instagram to Yard and then removed Yard from its Instagram settings with a request to delete its data, Yard deletes the posts and photos it imported from that account. Instagram gives you a link to this page with a confirmation code, which shows whether the request has been received or completed.
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <p>
          Email <SupportEmail /> or see <LegalLink href="/support">Support</LegalLink>. You can also complain to the Nigeria Data Protection Commission (NDPC).
        </p>
      </LegalSection>
    </LegalPage>
  )
}
