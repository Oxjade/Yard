import { createCn } from "cn/config"

/**
 * Class merging that knows the project's custom theme: without this, `cn` treats
 * `text-display-*` as a colour and drops it (or the colour next to it).
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["display-sm", "display-md", "display-lg", "display-xl", "display-2xl"] }] } },
})
