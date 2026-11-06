/**
 * The wordmark's type: the name in capitals (CSS, so `site.name` stays sentence case for
 * copy), wide and chromed. A four-letter name gets more size and tracking than a long one
 * would, so the mark holds its place; the negative right margin takes back the tracking after
 * the last letter, so the mark sits centred where it is placed. Callers add the size.
 *
 * A plain module (no "use client"), so server components (the footer, not-found) read the
 * string itself rather than a client reference.
 */
export const wordmarkType = "font-wide chrome-text uppercase leading-none tracking-[0.24em] -mr-[0.24em]"
