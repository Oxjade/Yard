/**
 * Platform size charts, keyed by the size set a product uses. Brands will upload their own
 * charts in Brand Studio (size_charts in the build brief); until then every product of a
 * kind shares these body-measurement tables.
 */

export type SizeChartKind = "apparel" | "shoes" | "rings"

export type SizeChart = {
  kind: SizeChartKind
  /** Column headings after the size column, without units (the unit line above the table carries them). */
  columns: string[]
  /** The unit line shown above a chart that can't switch units. */
  unitNote?: string
  /** One row per size, in the same order as `columns`. Values are in `unit`. */
  rows: { size: string; values: number[] }[]
  /** Unit the values are stored in; apparel can also be shown in inches. */
  unit: "cm" | "mm" | "none"
  convertible: boolean
  howToMeasure: { label: string; body: string }[]
}

const apparel: SizeChart = {
  kind: "apparel",
  columns: ["Chest", "Waist", "Hips"],
  unit: "cm",
  convertible: true,
  rows: [
    { size: "XS", values: [84, 68, 88] },
    { size: "S", values: [90, 74, 94] },
    { size: "M", values: [96, 80, 100] },
    { size: "L", values: [102, 86, 106] },
    { size: "XL", values: [110, 94, 114] },
  ],
  howToMeasure: [
    { label: "Chest", body: "Around the fullest part, under the arms, with the tape level." },
    { label: "Waist", body: "Around your natural waist, the narrowest part of your torso." },
    { label: "Hips", body: "Around the fullest part of your hips, feet together." },
  ],
}

const shoes: SizeChart = {
  kind: "shoes",
  columns: ["UK", "US men", "US women", "Foot length"],
  unitNote: "Foot length in cm",
  unit: "none",
  convertible: false,
  rows: [
    { size: "39", values: [6, 7, 8.5, 24.5] },
    { size: "40", values: [6.5, 7.5, 9, 25] },
    { size: "41", values: [7.5, 8.5, 10, 26] },
    { size: "42", values: [8, 9, 10.5, 26.5] },
    { size: "43", values: [9, 10, 11.5, 27.5] },
    { size: "44", values: [9.5, 10.5, 12, 28] },
    { size: "45", values: [10.5, 11.5, 13, 29] },
  ],
  howToMeasure: [
    { label: "Foot length", body: "Stand on paper with your heel against a wall and mark the tip of your longest toe. Measure both feet and use the longer one." },
  ],
}

const rings: SizeChart = {
  kind: "rings",
  columns: ["Inside diameter", "Circumference"],
  unitNote: "Measurements in mm",
  unit: "none",
  convertible: false,
  rows: [
    { size: "6", values: [16.5, 51.9] },
    { size: "7", values: [17.3, 54.4] },
    { size: "8", values: [18.1, 57.0] },
    { size: "9", values: [19.0, 59.5] },
    { size: "10", values: [19.8, 62.1] },
  ],
  howToMeasure: [
    { label: "Circumference", body: "Wrap a strip of paper around the base of your finger, mark where it overlaps and measure the length." },
    { label: "Diameter", body: "Measure the inside of a ring that already fits that finger, edge to edge." },
  ],
}

const charts: SizeChart[] = [apparel, shoes, rings]

/** The chart that matches a product's size values, or null when no chart applies. */
export function chartFor(sizes: string[]): SizeChart | null {
  if (!sizes.length) return null
  return charts.find((c) => sizes.every((s) => c.rows.some((r) => r.size === s))) ?? null
}

export function formatMeasure(value: number, unit: SizeChart["unit"], show: "cm" | "in") {
  if (unit === "cm" && show === "in") return (value / 2.54).toFixed(1)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
