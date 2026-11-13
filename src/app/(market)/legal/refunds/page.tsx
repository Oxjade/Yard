import type { Metadata } from "next"
import { LegalLink, LegalList, LegalPage, LegalSection, SupportEmail } from "@/components/market/legal-page"

export const metadata: Metadata = {
  title: "Returns and refunds",
  description: "How returns and refunds work on Yard: the 7-day returns window, what can't be returned, how to request a return, and when your refund arrives.",
}

/** /legal/refunds: the returns and refunds policy shoppers and brands follow on Yard. */
export default function RefundsPage() {
  return (
    <LegalPage
      title="Returns and refunds"
      intro={
        <>
          <p>
            Each item on Yard is sold by an independent brand. This policy is the minimum every brand on Yard offers. A brand may offer a more generous policy; if it does, it is shown on the product page and applies instead where it is better for you. This policy does not affect your rights under Nigerian consumer protection law.
          </p>
        </>
      }
    >
      <LegalSection title="Returns window">
        <p>
          You can request a return of an eligible item within 7 days of delivery. Some brands allow longer; check the product page or your order.
        </p>
      </LegalSection>

      <LegalSection title="Condition">
        <p>
          Returned items must be unworn, unwashed and unused, in their original condition and packaging, with all tags and accessories attached. If an item comes back worn, damaged or incomplete, the brand may refuse the return or reduce the refund.
        </p>
      </LegalSection>

      <LegalSection title="Items that can't be returned">
        <LegalList>
          <li>Items marked final sale, including drop items marked final sale.</li>
          <li>Items that have been worn, used, washed or altered.</li>
          <li>Underwear, swimwear without its hygiene liner, and other intimate items, for hygiene reasons.</li>
          <li>Custom, personalised or made-to-order items.</li>
          <li>International orders (orders delivered outside Nigeria), which are final sale.</li>
        </LegalList>
        <p>These exclusions don&apos;t apply if the item arrived damaged, faulty or not as described; see below.</p>
      </LegalSection>

      <LegalSection title="How to request a return">
        <LegalList>
          <li>Go to <LegalLink href="/you/orders">your account → Orders</LegalLink>, open the order and choose Request return.</li>
          <li>Select the items and tell us why you&apos;re returning them.</li>
          <li>The brand reviews the request and, once approved, sends you return instructions. Please don&apos;t send items back before your return is approved.</li>
          <li>Unless the item was damaged, faulty or wrong, you pay the cost of sending it back, unless the brand says otherwise.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Refunds">
        <p>
          Once the brand receives and checks your return, your refund is approved. Refunds go back to your original payment method through our payment processor, Bachs, within 5 to 10 business days after approval. How quickly it shows in your account depends on your bank. Original delivery charges are refunded only if the whole order is returned because it was damaged, faulty or wrong.
        </p>
      </LegalSection>

      <LegalSection title="Damaged, faulty or wrong items">
        <p>
          If an item arrives damaged, faulty or isn&apos;t what you ordered, report it within 48 hours of delivery from your order page, or email <SupportEmail /> with your order number and clear photos of the item, the label and the packaging. The brand will offer a replacement or a full refund, including delivery, and cover the cost of the return.
        </p>
      </LegalSection>

      <LegalSection title="Cancellations">
        <p>
          You can cancel an order at no cost before the brand dispatches it, from your order page or by messaging the brand. You get a full refund to your original payment method. Once an order has been dispatched it can&apos;t be cancelled, but you can return eligible items when they arrive. Made-to-order items may not be cancellable once production has started; the product page will say so.
        </p>
      </LegalSection>

      <LegalSection title="International orders">
        <p>
          Orders delivered outside Nigeria are final sale and can&apos;t be returned for a change of mind. If an international order arrives damaged, faulty or wrong, the damaged items section above still applies.
        </p>
      </LegalSection>

      <LegalSection title="Disputes">
        <p>
          If you and a brand can&apos;t agree on a return or refund, email <SupportEmail /> with your order number. Yard will review the order, messages and photos from both sides and decide the outcome, which may include a refund. Please contact us before opening a chargeback with your bank, as it can slow things down. You can also contact the Federal Competition and Consumer Protection Commission. See our <LegalLink href="/legal/terms">Terms</LegalLink> and <LegalLink href="/support">Support</LegalLink> for more.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
