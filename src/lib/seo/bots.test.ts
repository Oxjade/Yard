import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getsBlockingMetadata } from "./bots"

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"

describe("blocking metadata (next.config.ts htmlLimitedBots)", () => {
  it("browsers keep streaming metadata", () => {
    for (const ua of [CHROME, SAFARI_IOS, FIREFOX]) assert.equal(getsBlockingMetadata(ua), false, ua)
  })

  it("AI crawlers and assistants' fetchers get the metadata in the <head>", () => {
    for (const ua of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
      "CCBot/2.0 (https://commoncrawl.org/faq/)",
    ])
      assert.equal(getsBlockingMetadata(ua), true, ua)
  })

  it("keeps Next's own list (Bingbot, social previews)", () => {
    assert.equal(getsBlockingMetadata("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"), true)
    assert.equal(getsBlockingMetadata("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"), true)
    assert.equal(getsBlockingMetadata("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"), true)
  })

  it("non-browser clients (curl, HTTP libraries) get it too; no user agent at all streams, as in Next", () => {
    for (const ua of ["curl/8.5.0", "python-requests/2.32.3", "Wget/1.21.4", "node", "Go-http-client/2.0"]) assert.equal(getsBlockingMetadata(ua), true, ua)
    assert.equal(getsBlockingMetadata(""), false)
    assert.equal(getsBlockingMetadata(null), false)
  })
})
