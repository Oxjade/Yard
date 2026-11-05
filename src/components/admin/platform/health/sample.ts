/**
 * Operational sample figures for the health screen that the data layer doesn't model yet
 * (queue depth, storage, auth failures). Labelled as sample data wherever they appear; the
 * backend phase replaces them with the metrics pipeline.
 */

export const queues = [
  { name: "Images", key: "images", depth: 1_204, oldest: "6 min", alertAt: 1_000 },
  { name: "Notifications", key: "notifications", depth: 142, oldest: "38 s", alertAt: 2_000 },
  { name: "Email", key: "email", depth: 58, oldest: "21 s", alertAt: 2_000 },
  { name: "Analytics", key: "analytics", depth: 12, oldest: "2 min", alertAt: 500 },
  { name: "Payment webhooks", key: "webhooks", depth: 3, oldest: "4 s", alertAt: 200 },
]

/** Bytes are in gigabytes. */
export const storage = {
  quotaGb: 5_000,
  growth7dGb: 84,
  parts: [
    { label: "Product photos", gb: 2_104, tone: "purple" as const },
    { label: "Brand covers and storefronts", gb: 642, tone: "violet" as const },
    { label: "Stories and lookbooks", gb: 518, tone: "grey" as const },
    { label: "Exports and backups", gb: 156, tone: "ink" as const },
  ],
}

export const authFailures = [
  { label: "Failed shopper sign-ins", value: 214, hint: "0.9% of sign-in attempts" },
  { label: "Failed admin sign-ins", value: 3, hint: "all from known devices", attention: false },
  { label: "Failed MFA challenges", value: 7, hint: "4 shoppers, 3 brand owners" },
  { label: "Accounts locked", value: 4, hint: "after 5 failed attempts", attention: true },
  { label: "Requests rate-limited", value: 1_180, hint: "from 2 IP ranges, now blocked" },
]

/** What an engineer should know before retrying a failed job. */
export const jobHints: Record<string, string> = {
  job_8812: "The push provider is back to normal; a retry should go through.",
  job_8790: "Will fail again until the brand uploads a smaller image. Retry after the brand is told.",
  job_8741: "Lock contention cleared after the nightly vacuum; safe to retry.",
}
