import { createCn } from "cn/config"

/**
 * Class merging that knows the project's custom theme: without this, `cn` treats
 * `text-display-*` as a colour and drops it (or the colour next to it).
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["display-sm", "display-md", "display-lg", "display-xl", "display-2xl"] }] } },
})

/** A count with the noun that agrees with it: "1 piece", "12 pieces", "1,200 units". */
export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
}
