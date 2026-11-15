import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { newsletterBlocksText, newsletterGreeting, newsletterLink, newsletterProblems, parseNewsletterBody, soundsPromotional, type NewsletterContent } from "./newsletter"

const O = "https://yard.example"

describe("newsletter links", () => {
  it("Yard paths become absolute; https stays; everything else is refused", () => {
    assert.equal(newsletterLink("/shop", O), "https://yard.example/shop")
    assert.equal(newsletterLink("https://instagram.com/yard", O), "https://instagram.com/yard")
    assert.equal(newsletterLink("http://evil.example", O), null)
    assert.equal(newsletterLink("http://yard.example/x", "http://yard.example"), "http://yard.example/x")
    assert.equal(newsletterLink("javascript:alert(1)", O), null)
    assert.equal(newsletterLink("//evil.example", O), null)
    assert.equal(newsletterLink("mailto:a@b.co", O), null)
    assert.equal(newsletterLink("https://user:pw@evil.example", O), null)
    assert.equal(newsletterLink("shop", O), null)
  })
})

describe("newsletter body", () => {
  it("paragraphs, bold, links and bullets", () => {
    const { blocks, badLinks } = parseNewsletterBody("Hey **you**!\nSecond line.\n\nWhat's new:\n- [Drops](/drops)\n- **Restocks**\n\nBye", O)
    assert.deepEqual(badLinks, [])
    assert.deepEqual(blocks, [
      { kind: "p", runs: [{ text: "Hey " }, { text: "you", bold: true }, { text: "!\nSecond line." }] },
      { kind: "p", runs: [{ text: "What's new:" }] },
      { kind: "ul", items: [[{ text: "Drops", href: "https://yard.example/drops" }], [{ text: "Restocks", bold: true }]] },
      { kind: "p", runs: [{ text: "Bye" }] },
    ])
  })

  it("a link it can't use keeps its words and is reported", () => {
    const { blocks, badLinks } = parseNewsletterBody("Tap [here](javascript:alert(1)) now", O)
    assert.deepEqual(badLinks, ["javascript:alert(1"])
    assert.equal(blocks[0].kind === "p" && blocks[0].runs.some((r) => r.href), false)
  })

  it("HTML is just text (the layout escapes it)", () => {
    const { blocks } = parseNewsletterBody("<b>hi</b>", O)
    assert.deepEqual(blocks, [{ kind: "p", runs: [{ text: "<b>hi</b>" }] }])
  })

  it("plain text twin", () => {
    const { blocks } = parseNewsletterBody("Hi\n\n- [Shop](/shop)", O)
    assert.deepEqual(newsletterBlocksText(blocks), ["Hi", "• Shop (https://yard.example/shop)"])
  })

  it("greets by first name", () => {
    assert.equal(newsletterGreeting("Ada Nwosu"), "Hey Ada,")
    assert.equal(newsletterGreeting(" "), null)
  })
})

describe("ready to send", () => {
  const base: NewsletterContent = { kind: "marketing", subject: "Fresh in", preheader: "", heading: "Fresh", body: "Something good is here.", heroMediaId: null, heroAlt: "", buttonLabel: "", buttonUrl: "", audience: { type: "shoppers" } }
  it("a complete draft has no problems", () => assert.deepEqual(newsletterProblems(base, O), {}))
  it("names each missing piece", () => {
    const p = newsletterProblems({ ...base, subject: "", heading: "", body: "short", buttonLabel: "Go", heroMediaId: "med_1", audience: { type: "followers", brandId: "" } }, O)
    assert.deepEqual(Object.keys(p).sort(), ["audience", "body", "buttonUrl", "heading", "heroAlt", "subject"])
  })
  it("refuses a bad button link or a bad body link", () => {
    assert.ok(newsletterProblems({ ...base, buttonLabel: "Go", buttonUrl: "ftp://x" }, O).buttonUrl)
    assert.ok(newsletterProblems({ ...base, body: "See [this](data:text/html,hi) please" }, O).body)
  })
  it("flags promotional words in a service notice", () => {
    assert.equal(soundsPromotional({ subject: "We updated our terms", heading: "Terms update", body: "Here's what changed." }), false)
    assert.equal(soundsPromotional({ subject: "20% off this weekend", heading: "Sale", body: "Shop now" }), true)
  })
})
