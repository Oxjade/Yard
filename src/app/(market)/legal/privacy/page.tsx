import type { Metadata } from "next"
import { LegalLink, LegalList, LegalPage, LegalSection, OPERATOR, SupportEmail } from "@/components/market/legal-page"

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal data Yard collects, why, who it is shared with, how long it is kept, and your rights under the Nigeria Data Protection Act 2023.",
}

/** /legal/privacy: Yard's privacy policy. OWNER: fill in the operator details in src/components/market/legal-page.tsx. */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <>
          <p>
            Yard is a marketplace based in Nigeria that connects shoppers with independent brands. This policy explains what personal data we collect when you use Yard, why we collect it, who we share it with and the rights you have over it.
          </p>
          <p>
            Yard is operated by {OPERATOR} (&quot;Yard&quot;, &quot;we&quot;, &quot;us&quot;). We are the data controller for the personal data described here. Questions about this policy can be sent to <SupportEmail />.
          </p>
        </>
      }
    >
      <LegalSection title="1. What we collect">
        <LegalList>
          <li><strong className="font-normal text-ink">Account details:</strong> your name, email address, password (stored only in hashed form by our sign-in provider), profile photo and preferences. If you sign in with Google, Facebook or Apple, we receive your name, email address and profile photo from that provider.</li>
          <li><strong className="font-normal text-ink">Orders:</strong> what you bought, from which brand, prices, order status, returns and refunds.</li>
          <li><strong className="font-normal text-ink">Addresses and contact details:</strong> the delivery address and phone number you give at checkout.</li>
          <li><strong className="font-normal text-ink">Payment status:</strong> whether a payment succeeded, failed or was refunded, the payment method type and a reference from our payment processor. We do not see or store your full card number, CVV or bank login details; these go directly to our payment processor, Bachs.</li>
          <li><strong className="font-normal text-ink">Device and usage data:</strong> your IP address, browser and device type, pages and products you view, searches, items you save or follow, and approximate location derived from your IP address or that you choose to share (for example on Around).</li>
          <li><strong className="font-normal text-ink">Messages and content:</strong> messages you send to brands or to Yard support, reviews, reports and photos you upload.</li>
          <li><strong className="font-normal text-ink">Brand accounts:</strong> if you sell on Yard, your business details, payout details and the content of your store.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. Why we use it">
        <LegalList>
          <li>To create and run your account and sign you in.</li>
          <li>To process orders and payments, pass orders to brands for fulfilment, arrange delivery, and handle returns and refunds.</li>
          <li>To send service emails such as order confirmations, dispatch notices, password resets and replies to your messages.</li>
          <li>To show you relevant brands, products, drops and charts, and to remember what you saved or followed.</li>
          <li>To run drops and draws fairly, including enforcing purchase limits and detecting duplicate or automated entries.</li>
          <li>To keep Yard safe: preventing fraud, spam and abuse, and enforcing our <LegalLink href="/legal/terms">Terms</LegalLink>.</li>
          <li>To understand how Yard is used and improve it.</li>
          <li>To meet our legal, tax and accounting obligations.</li>
          <li>With your consent, to send you marketing emails. You can unsubscribe at any time from the link in each email or in <LegalLink href="/you/settings">Settings</LegalLink>.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. Legal bases">
        <p>Under the Nigeria Data Protection Act 2023 (NDPA), we process your personal data on these lawful bases:</p>
        <LegalList>
          <li><strong className="font-normal text-ink">Contract:</strong> to provide your account and complete your orders.</li>
          <li><strong className="font-normal text-ink">Legal obligation:</strong> to keep transaction records and respond to lawful requests.</li>
          <li><strong className="font-normal text-ink">Legitimate interests:</strong> to keep Yard secure, prevent fraud, run fair drops and improve the service, where those interests are not overridden by your rights.</li>
          <li><strong className="font-normal text-ink">Consent:</strong> for marketing emails and optional features such as sharing your location. You can withdraw consent at any time; this does not affect processing that happened before.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Who we share it with">
        <p>We do not sell your personal data. We share it only as needed to run Yard:</p>
        <LegalList>
          <li><strong className="font-normal text-ink">Brands:</strong> when you order from a brand, it receives your name, delivery address, phone number, order details and any messages you send it, so it can fulfil and support your order. Each brand is responsible for how it uses that data.</li>
          <li><strong className="font-normal text-ink">Bachs:</strong> our payment processor, which handles card and bank transfer payments and refunds.</li>
          <li><strong className="font-normal text-ink">Couriers and delivery partners:</strong> your name, address and phone number to deliver your order.</li>
          <li><strong className="font-normal text-ink">Resend:</strong> our email provider, which sends our service and marketing emails.</li>
          <li><strong className="font-normal text-ink">Auth0, Google, Facebook and Apple:</strong> our sign-in provider Auth0 handles sign-in, and Google, Facebook or Apple are involved only if you choose to sign in with them.</li>
          <li><strong className="font-normal text-ink">Hosting and infrastructure:</strong> the providers that host Yard&apos;s servers and store its data.</li>
          <li><strong className="font-normal text-ink">Authorities:</strong> regulators, law enforcement or courts where the law requires it, or to protect the rights and safety of our users or Yard.</li>
          <li><strong className="font-normal text-ink">A buyer of our business:</strong> if Yard is sold or merged, under the same protections as this policy.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. How long we keep it">
        <LegalList>
          <li>Account data: for as long as your account is open, and deleted or anonymised within 90 days after you close it, unless we need it for the reasons below.</li>
          <li>Order, payment and tax records: for 6 years after the transaction, as Nigerian tax and accounting law requires.</li>
          <li>Messages and support requests: for up to 2 years after the last message, or longer if needed for a dispute.</li>
          <li>Security and usage logs: generally for up to 12 months.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. Your rights">
        <p>Under the NDPA you have the right to:</p>
        <LegalList>
          <li>be told how your personal data is used (this policy);</li>
          <li>access the personal data we hold about you and get a copy;</li>
          <li>have inaccurate data corrected;</li>
          <li>have your data deleted where we no longer have a lawful reason to keep it;</li>
          <li>restrict or object to processing, including objecting to direct marketing at any time;</li>
          <li>receive your data in a commonly used, machine-readable format and have it sent to another controller (data portability);</li>
          <li>withdraw consent where we rely on it;</li>
          <li>not be subject to a decision based solely on automated processing that significantly affects you;</li>
          <li>complain to the Nigeria Data Protection Commission (NDPC).</li>
        </LegalList>
        <p>
          To exercise any of these rights, email <SupportEmail /> from the address on your account and tell us what you would like. We may ask you to confirm your identity. We will respond within 30 days. You can update most account details yourself in <LegalLink href="/you/settings">Settings</LegalLink>. See also <LegalLink href="/support">Support</LegalLink> for how to delete your data.
        </p>
      </LegalSection>

      <LegalSection title="7. Cookies">
        <p>
          Yard uses only essential cookies and similar browser storage: to keep you signed in, remember your cart and preferences, and protect against fraud. We do not use advertising or cross-site tracking cookies, and we do not let advertisers track you on Yard. You can block cookies in your browser, but signing in and checkout will not work without them.
        </p>
      </LegalSection>

      <LegalSection title="8. Children">
        <p>
          Yard is not for children under 13, and we do not knowingly collect their personal data. You must be 18 or older to make a purchase. If you are between 13 and 18, you may only use Yard with the involvement of a parent or guardian. If you believe a child has given us personal data, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="9. International transfers">
        <p>
          Some of our service providers, such as our email, sign-in and hosting providers, may process data outside Nigeria. When we transfer personal data abroad we do so in line with the NDPA, relying on adequate protection in the destination country, contractual safeguards or another lawful basis the Act provides.
        </p>
      </LegalSection>

      <LegalSection title="10. Security">
        <p>
          We protect your data with encryption in transit, access controls, and by limiting access to people who need it. Passwords are handled by our sign-in provider and are never stored in plain text. No service is completely secure; if a breach affects your personal data in a way that is likely to harm you, we will tell you and the NDPC as the law requires.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to this policy">
        <p>
          We may update this policy from time to time. We will change the &quot;Last updated&quot; date above, and if the changes are significant we will tell you by email or on Yard before they take effect.
        </p>
      </LegalSection>

      <LegalSection title="12. Contact">
        <p>
          {OPERATOR}. Email: <SupportEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
