/**
 * Code 128 (code set B) for the ticket receipt's barcode (§6.6). Pure and isomorphic: no imports,
 * so `tsx --test` runs its test as plain Node.
 *
 * Each symbol is six alternating bar/space widths (in modules) summing to 11; the stop symbol has
 * seven (13 modules). A barcode is: quiet zone, Start B, the data symbols (char code − 32), the
 * checksum ((104 + Σ value × position) mod 103), Stop, quiet zone. `decode128` reads widths back
 * into text, so the receipt can be checked against its own reference.
 */

/** Code 128 symbol widths, values 0–105 (106 is Stop), bar first. */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const

export const START_B = 104
export const STOP = 106
/** Modules of blank space either side, as the symbology requires. */
export const QUIET = 10

/** The symbol widths table, for tests. */
export const code128Patterns: readonly string[] = PATTERNS

/** Whether a string can be encoded in code set B (printable ASCII, 32–126). */
export function canEncode128B(text: string) {
  return text.length > 0 && [...text].every((c) => {
    const code = c.charCodeAt(0)
    return code >= 32 && code <= 126
  })
}

/** The symbol values for `text`: Start B, data, checksum, Stop. Throws on characters outside set B. */
export function symbols128B(text: string): number[] {
  if (!canEncode128B(text)) throw new Error("Code 128B encodes printable ASCII only")
  const data = [...text].map((c) => c.charCodeAt(0) - 32)
  const checksum = (START_B + data.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103
  return [START_B, ...data, checksum, STOP]
}

/** Alternating bar/space widths in modules, starting with a bar (quiet zones not included). */
export function encode128B(text: string): number[] {
  return symbols128B(text).flatMap((v) => [...PATTERNS[v]].map(Number))
}

/** The bars as `[x, width]` pairs in modules (x counts the leading quiet zone), and the total width. */
export function barcodeBars(text: string): { bars: [number, number][]; width: number } {
  const widths = encode128B(text)
  const bars: [number, number][] = []
  let x = QUIET
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push([x, w])
    x += w
  })
  return { bars, width: x + QUIET }
}

const VALUE_OF = new Map<string, number>(PATTERNS.map((p, v) => [p, v]))

/**
 * Reads alternating bar/space widths (bar first, no quiet zones) back into text. Returns null when
 * the widths aren't a valid Code 128B barcode: wrong start, an unknown symbol, a bad checksum or
 * a missing stop.
 */
export function decode128(widths: number[]): string | null {
  if (widths.length < 6 * 3 + 7 || (widths.length - 7) % 6 !== 0) return null
  const stop = widths.slice(-7).join("")
  if (stop !== PATTERNS[STOP]) return null
  const values: number[] = []
  for (let i = 0; i < widths.length - 7; i += 6) {
    const v = VALUE_OF.get(widths.slice(i, i + 6).join(""))
    if (v === undefined) return null
    values.push(v)
  }
  if (values[0] !== START_B || values.slice(1).some((v) => v > 102)) return null
  const data = values.slice(1, -1)
  const checksum = values[values.length - 1]
  if (data.some((v) => v > 94)) return null
  if ((START_B + data.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103 !== checksum) return null
  return String.fromCharCode(...data.map((v) => v + 32))
}

/**
 * Reads a rendered row of modules (true = black), quiet zones included, the way a scanner reads a
 * scan line: trims the blank margins and turns the runs into widths, then decodes them.
 */
export function decodeModules(row: boolean[]): string | null {
  const first = row.indexOf(true)
  const last = row.lastIndexOf(true)
  if (first < 0) return null
  const widths: number[] = []
  let run = 0
  let cur = true
  for (let i = first; i <= last; i++) {
    if (row[i] === cur) run++
    else {
      widths.push(run)
      cur = row[i]
      run = 1
    }
  }
  widths.push(run)
  return decode128(widths)
}
