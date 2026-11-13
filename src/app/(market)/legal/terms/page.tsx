import type { Metadata } from "next"
import { LegalLink, LegalList, LegalPage, LegalSection, OPERATOR, SupportEmail } from "@/components/market/legal-page"

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using Yard, the Nigerian marketplace for independent brands: accounts, orders, payments, delivery, drops and draws, and your rights.",
}

/** /legal/terms: the terms of use for shoppers and everyone using Yard. OWNER: fill in the operator details. */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro={
        <>
          <p>
            These terms apply when you use Yard, a marketplace that connects shoppers with independent brands. Yard is operated by {OPERATOR} (&quot;Yard&quot;, &quot;we&quot;, &quot;us&quot;). By creating an account or placing an order, you agree to these terms and to our <LegalLink href="/legal/privacy">Privacy policy</LegalLink>.
          </p>
        </>
      }
    >
      <LegalSection title="1. Your account">
        <LegalList>
          <li>You can browse Yard without an account. To buy, follow brands, enter draws or send messages you need one.</li>
          <li>You can sign up with an email and password, or with Google, Facebook or Apple. Give accurate details and keep them up to date.</li>
          <li>You must be at least 13 to have an account and at least 18 to make a purchase.</li>
          <li>Keep your sign-in details secret. You are responsible for activity on your account; tell us straight away at <SupportEmail /> if you think someone else has used it.</li>
          <li>One person, one account. Accounts may not be shared, sold or transferred.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. Yard's role">
        <p>
          Yard is the platform. The independent brands on Yard are the sellers of their items. When you buy something, your contract of sale is with the brand. The brand is responsible for its products, including their description, quality, safety, legality, stock and delivery. Yard provides the marketplace, takes payment on the brand&apos;s behalf through our payment processor, and helps when something goes wrong, but Yard is not the seller and does not own or inspect the items listed.
        </p>
      </LegalSection>

      <LegalSection title="3. Orders and payments">
        <LegalList>
          <li>Placing an order is an offer to buy from the brand. The order is accepted when payment succeeds and you receive an order confirmation.</li>
          <li>A brand may cancel an order, for example if an item is out of stock or was listed at an obvious pricing error. If that happens you get a full refund.</li>
          <li>Payments are processed by Bachs, by card or bank transfer. Yard does not see or store your full card details.</li>
          <li>If a payment fails or is reversed, we may cancel the order or suspend the account involved.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Pricing and currency">
        <p>
          Prices are set by each brand and shown in Nigerian naira (NGN) unless stated otherwise. Where Yard shows a price in another currency, it is an estimate for your convenience; you are charged the amount shown at checkout. Delivery costs and any taxes are shown before you pay. Your bank may charge its own fees for international or foreign-currency payments.
        </p>
      </LegalSection>

      <LegalSection title="5. Delivery">
        <p>
          Brands dispatch their own orders. Delivery estimates are shown on the product page and at checkout and are estimates, not guarantees. Please give a complete, correct delivery address and a phone number the courier can reach. If delivery fails because of a wrong address or because no one was available, the brand may charge to send it again. Risk in the items passes to you on delivery.
        </p>
      </LegalSection>

      <LegalSection title="6. Returns and refunds">
        <p>
          Our <LegalLink href="/legal/refunds">Returns and refunds policy</LegalLink> explains which items can be returned, how to request a return and how refunds are paid. Nothing in these terms limits rights you have under Nigerian consumer protection law, including the Federal Competition and Consumer Protection Act 2018.
        </p>
      </LegalSection>

      <LegalSection id="drops" title="7. Drops and draws">
        <LegalList>
          <li>A drop is a limited release that goes on sale at a set time. A draw is a chance to buy a limited item: you enter during the entry window and winners are picked when it closes.</li>
          <li>Each drop or draw shows its rules, including opening and closing times, the purchase limit per person and whether items are final sale. Limits apply per person, not per account, payment method or address.</li>
          <li>Entering a draw is free and does not guarantee you can buy. Winners are chosen at random from eligible entries. Yard may exclude entries that break these terms, such as duplicate accounts, automated entries or entries using false details.</li>
          <li>Winners are notified by email and on Yard and have a set purchase window, shown on the draw, to complete their purchase. If a winner does not buy in time, the item may be offered to another entrant.</li>
          <li>Bots, scripts and other automated tools for entering draws or buying drops are prohibited. Orders placed this way may be cancelled and refunded.</li>
          <li>A cart does not reserve stock. An item in a drop is only yours once your payment succeeds.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="8. Prohibited use">
        <p>You must not:</p>
        <LegalList>
          <li>break the law, or buy or sell items that are illegal, counterfeit or infringe someone else&apos;s rights;</li>
          <li>commit fraud, including using stolen payment details or making false claims for refunds;</li>
          <li>harass, threaten or abuse brands, shoppers or Yard staff, or send spam;</li>
          <li>post content that is unlawful, hateful, sexually explicit, misleading or that you do not have the rights to;</li>
          <li>scrape, copy or resell Yard&apos;s content or data, or use bots to access Yard;</li>
          <li>interfere with Yard&apos;s security or operation, or try to access accounts or data that are not yours;</li>
          <li>arrange to pay a brand outside Yard for items you found on Yard.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="9. Content and intellectual property">
        <p>
          Yard&apos;s name, logo, design and software belong to Yard. Product photos, descriptions and brand names belong to the brands that post them. You may use Yard for your own personal, non-commercial shopping.
        </p>
        <p>
          When you post content on Yard, such as a review, photo or message, you keep ownership of it but give Yard a worldwide, royalty-free licence to host, display and share it on Yard and in promoting Yard, for as long as it is on Yard. You confirm you have the right to post it. We may remove content that breaks these terms. If you believe content on Yard infringes your rights, email <SupportEmail />.
        </p>
      </LegalSection>

      <LegalSection title="10. Selling on Yard">
        <p>
          Brands that sell on Yard also agree to the <LegalLink href="/legal/seller-agreement">Seller agreement</LegalLink>. In summary, brands list their own products and are responsible for them, fulfil and ship their orders, handle returns in line with our <LegalLink href="/legal/refunds">Returns and refunds policy</LegalLink>, and respond to shoppers promptly. Opening a store on Yard is free. Yard charges no commission on sales placed before 12 February 2027; after that, Yard charges a commission of 3.5% on each completed sale. Payouts are made to the brand&apos;s registered account after deducting commission and any refunds.
        </p>
      </LegalSection>

      <LegalSection title="11. Our liability">
        <LegalList>
          <li>Yard is provided &quot;as is&quot;. We work to keep it available and accurate, but we cannot promise it will always be uninterrupted or error-free.</li>
          <li>Because brands are the sellers, Yard is not liable for the products themselves, though we will help you resolve problems with a brand.</li>
          <li>To the extent the law allows, Yard is not liable for indirect or consequential loss, or loss of profit, data or opportunity, and our total liability to you for any claim is limited to the amount you paid for the order the claim relates to, or ₦50,000 if the claim does not relate to an order.</li>
          <li>Nothing in these terms excludes liability that cannot be excluded by law, including for fraud, or for death or personal injury caused by negligence.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="12. Suspension and closing accounts">
        <p>
          We may suspend or close an account, remove content, or cancel orders if you break these terms, if we suspect fraud or abuse, or if the law requires it. Where it is safe to, we will tell you why. You can close your account at any time by emailing <SupportEmail />. Orders already placed will still be completed or refunded.
        </p>
      </LegalSection>

      <LegalSection title="13. Governing law and disputes">
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria. If you have a problem, please contact us first at <SupportEmail /> and we will try to resolve it. If we cannot, the dispute will be decided by the courts of Lagos State, Nigeria, without affecting any right you have to bring a claim elsewhere or to complain to the Federal Competition and Consumer Protection Commission.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes to these terms">
        <p>
          We may update these terms. We will change the &quot;Last updated&quot; date above, and if the changes are significant we will tell you by email or on Yard before they take effect. The terms in force when you placed an order apply to that order.
        </p>
      </LegalSection>

      <LegalSection title="15. Contact">
        <p>
          {OPERATOR}. Email: <SupportEmail />. For help with an order, see <LegalLink href="/support">Support</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
