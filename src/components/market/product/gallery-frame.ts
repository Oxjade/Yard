/**
 * The product photograph's frame, shared by the gallery and the page's loading state so the
 * two match. Edge to edge at 4:5 on phones, but never so tall that the first screen hides the
 * name and price under the home bar: the height leaves room for the header and breadcrumb
 * (152px), the brand row, a two-line name and the price (210px) and the home bar with its
 * raised Around pin and a gap (100px, --tabbar-clear), plus the home indicator's safe area. On
 * most phones that budget wins (390×844 keeps a 380px photograph). Only on short screens (a
 * 667px iPhone SE, or Safari with its toolbars showing) does the floor of 56% of the width take
 * over, so the photograph stays a photograph rather than a strip; at 375×667 the budget still
 * keeps 210px there (the budget alone would leave 203px). From md the gallery sits beside the buy box at 4:5.
 *
 * A plain module (no "use client"), so the server-rendered loading state reads the string.
 */
export const galleryFrame =
  "-mx-4 aspect-[4/5] max-md:aspect-auto max-md:h-[min(125vw,max(56vw,calc(100svh-29rem-env(safe-area-inset-bottom,0px))))] md:mx-0 md:rounded-lg lg:max-h-[calc(100dvh-8rem)] lg:w-full"
