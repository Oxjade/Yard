/**
 * Yard's buyer policies as facts for structured data, the product feed and llms.txt. They repeat
 * what the legal pages say (src/app/(market)/legal/refunds, terms; /support): when a page changes,
 * change this file with it. Category-neutral on purpose: nothing here assumes what a brand sells.
 */
export const yardPolicies = {
  /** Returns and refunds: the minimum every brand offers (a brand may offer longer). */
  returns: {
    days: 7,
    /** Orders delivered here can be returned; orders delivered elsewhere are final sale. */
    country: "NG",
    countryName: "Nigeria",
    /** The shopper pays to send a change-of-mind return back (damaged, faulty or wrong items excepted). */
    fees: "customer" as const,
    method: "by mail" as const,
    refundDays: [5, 10] as [number, number],
    path: "/legal/refunds",
  },
  /** Cancel at no cost until the brand dispatches the order. */
  cancellation: "free before dispatch",
  /** Damaged, faulty or wrong items: report within this many hours of delivery. */
  damagedReportHours: 48,
  /**
   * How shoppers pay, by the provider this deployment has switched on (YARD_PAYMENTS). Only said
   * while checkout is open: with payments off, llms.txt says checkout is opening soon instead.
   */
  paymentsBy: {
    bachs: "card or bank transfer, processed by Bachs",
    paystack: "card or bank transfer, processed by Paystack",
  },
  pricesShownIn: "NGN",
  supportEmail: "support@yardstore.space",
  supportReplyBusinessDays: 2,
} as const
