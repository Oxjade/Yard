import type { Metadata } from "next"
import { MessageSupportButton } from "@/components/inbox/entry"
import { LegalLink, LegalList, LegalPage, LegalSection, SupportEmail } from "@/components/market/legal-page"

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with orders, delivery, returns, drops, your account or selling on Yard. Message Yard Support or email us and a person on the Yard team replies.",
}

/** /support: how to reach Yard, and quick answers to the questions shoppers and brands ask most. */
export default function SupportPage() {
  return (
    <LegalPage
      title="Support"
      intro={
        <>
          <p>Need help with an order, your account or selling on Yard? Message Yard Support and a person on the Yard team replies in your inbox. You can also email us at <SupportEmail />.</p>
          <div>
            <MessageSupportButton variant="primary" />
          </div>
          <p>We aim to reply within 2 business days (Monday to Friday, excluding Nigerian public holidays). Brands can message Yard Support from Studio.</p>
        </>
      }
    >
      <LegalSection title="What to include">
        <p>So we can help you quickly, please include:</p>
        <LegalList>
          <li>Your order number, if your question is about an order (you&apos;ll find it in your confirmation email and under <LegalLink href="/you/orders">Orders</LegalLink>).</li>
          <li>The email address you use for your Yard account.</li>
          <li>The brand and item, and what went wrong.</li>
          <li>Photos, if an item arrived damaged or isn&apos;t what you ordered.</li>
        </LegalList>
        <p>Never send us your card number, PIN, password or one-time codes. Yard will never ask for them.</p>
      </LegalSection>

      <LegalSection title="Delivery times">
        <p>
          Each brand ships its own orders, so delivery times depend on the brand and where you are. The estimate is shown on the product page and at checkout. Most orders within Lagos arrive in a few business days; other states and international orders take longer. Items made to order or sold in a drop may take longer, and the product page will say so.
        </p>
      </LegalSection>

      <LegalSection title="Tracking your order">
        <p>
          When a brand dispatches your order we email you, with tracking details where the courier provides them. You can see the status of every order under <LegalLink href="/you/orders">Orders</LegalLink>. If your order hasn&apos;t moved for a while, message the brand from the order page or email us with your order number.
        </p>
      </LegalSection>

      <LegalSection title="Returns and refunds">
        <p>
          Eligible items can be returned within 7 days of delivery, and some brands offer longer. Start a return from your order page. Refunds go back to your original payment method. Read the full <LegalLink href="/legal/refunds">Returns and refunds policy</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Drops and draws">
        <p>
          A drop is a limited release that goes on sale at a set time. A draw lets you enter for the chance to buy a limited item: winners are picked at random when entries close and get a set time to complete their purchase. Purchase limits, opening times and any final-sale rules are shown on each drop. See <LegalLink href="/legal/terms#drops">Drops and draws</LegalLink> in our Terms, and find live and upcoming releases on <LegalLink href="/drops">Drops</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Sell on Yard">
        <p>
          Independent brands can open a store on Yard for free. Start from <LegalLink href="/studio">Brand Studio</LegalLink>, where you&apos;ll set up your store, list products and manage orders. The terms for brands are in the <LegalLink href="/legal/seller-agreement">Seller agreement</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Account and sign-in help">
        <LegalList>
          <li>You can sign in with your email and password, or with Google, Facebook or Apple. Use the same method you signed up with, so you land in the same account.</li>
          <li>Forgotten your password? Choose &quot;Forgot password&quot; on the sign-in screen and we&apos;ll email you a reset link. Check your spam folder if it doesn&apos;t arrive within a few minutes.</li>
          <li>Change your name, email and notification preferences under <LegalLink href="/you/settings">Settings</LegalLink>.</li>
          <li>Still stuck? Message Yard Support, or email us from the address on your account and tell us how you signed up.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Deleting your data">
        <p>
          To close your account and have your personal data deleted, email <SupportEmail /> from the address on your account. Some records, such as order and payment records, must be kept for a time by law; our <LegalLink href="/legal/privacy">Privacy policy</LegalLink> explains what and for how long. If you connected Instagram and removed Yard from it, you can check your request on the <LegalLink href="/legal/data-deletion">data deletion status page</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
