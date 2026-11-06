/**
 * Tile spans for the category index (category-mosaic.tsx), shared with its loading skeleton
 * so the tiles land exactly where their placeholders were.
 */
export const mosaicLayout = [
  // [phone, desktop] — desktop is a 12-column grid with fixed-height rows
  { m: "col-span-2 row-span-2", d: "md:col-span-7 md:row-span-2", size: "lg" },
  { m: "col-span-1 row-span-1", d: "md:col-span-5 md:row-span-1", size: "md" },
  { m: "col-span-1 row-span-1", d: "md:col-span-5 md:row-span-1", size: "md" },
  { m: "col-span-1 row-span-2", d: "md:col-span-4 md:row-span-2", size: "lg" },
  { m: "col-span-1 row-span-1", d: "md:col-span-4 md:row-span-1", size: "sm" },
  { m: "col-span-1 row-span-1", d: "md:col-span-4 md:row-span-1", size: "sm" },
  { m: "col-span-2 row-span-1", d: "md:col-span-8 md:row-span-1", size: "md" },
  { m: "col-span-1 row-span-2", d: "md:col-span-5 md:row-span-2", size: "lg" },
  { m: "col-span-1 row-span-1", d: "md:col-span-7 md:row-span-1", size: "md" },
  { m: "col-span-1 row-span-1", d: "md:col-span-7 md:row-span-1", size: "md" },
] as const

export const MOSAIC_GRID = "grid auto-rows-[180px] grid-cols-2 gap-3 sm:auto-rows-[220px] md:auto-rows-[240px] md:grid-cols-12 md:gap-4 lg:auto-rows-[280px]"
