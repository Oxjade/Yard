/**
 * Page titles and descriptions for the catalogue pages. Shared by the pages and their route
 * loading states, so the real header renders straight away and nothing changes when the
 * content streams in. A plain module (no "use client"), so server components can read it.
 */
export const productsCopy = {
  title: "Products",
  description: "Everything you sell, in every state. Select several to publish or archive them together.",
}

export const inventoryCopy = {
  title: "Inventory",
  description: "Stock for every size and colour you sell. Adjust a count when stock arrives, gets damaged or comes back.",
  note: "Stock counts are kept in Studio. The marketplace shows them once the catalogue backend is connected.",
}

export const collectionsCopy = {
  title: "Collections",
  description: "Group products into drops, seasons or edits, so shoppers can see the pieces side by side on your storefront.",
  note: "Collections are saved in Studio. Your live storefront lists them once the catalogue backend is connected.",
}
