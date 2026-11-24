import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pageAccess, type AdminAccess, type CookieHints, type PageAccess, type StudioAccess } from "./access-gate"
import { studioGateRedirect } from "./studio-gate"

/**
 * The route-access matrix in production (demo switch off), as src/proxy.ts decides it: who gets
 * which page, and where everyone else is sent. Each persona carries the cookies a browser would
 * and the answers GET /api/pages/access gives for its real session.
 */
type Persona = { cookies: CookieHints; admin: AdminAccess; studio: StudioAccess }

const none: CookieHints = { shopper: false, brand: false, admin: false }
const personas: Record<string, Persona> = {
  anonymous: { cookies: none, admin: { admin: false, permitted: false, signedIn: false }, studio: { shopper: false, brandMember: false } },
  shopper: { cookies: { ...none, shopper: true }, admin: { admin: false, permitted: false, signedIn: true }, studio: { shopper: true, brandMember: false } },
  // A brand member signed in to the shop and to Studio (the brand session cookie).
  "brand member": { cookies: { ...none, shopper: true, brand: true }, admin: { admin: false, permitted: false, signedIn: true }, studio: { shopper: true, brandMember: true } },
  // The admin persona is an Owner: every section is in the role.
  admin: { cookies: { ...none, admin: true }, admin: { admin: true, permitted: true, signedIn: true }, studio: { shopper: false, brandMember: false } },
}

/** The full proxy order: the studio gate's answer, then pageAccess, then the studio gate's redirect. */
async function decide(p: Persona, url: string, overrides: { admin?: AdminAccess } = {}): Promise<PageAccess> {
  const [path, query = ""] = url.split("?")
  const search = query ? `?${query}` : ""
  const studioSignIn = studioGateRedirect({ path, search, seedDemo: false, hasBrandCookie: p.cookies.brand })
  const out = await pageAccess({ path, search, cookies: p.cookies, studioSignIn, ask: { admin: async () => overrides.admin ?? p.admin, studio: async () => p.studio } })
  if (out.kind === "pass" && studioSignIn) return { kind: "redirect", to: studioSignIn }
  return out
}

const pass: PageAccess = { kind: "pass" }
const to = (target: string): PageAccess => ({ kind: "redirect", to: target })

// /dev is not gated by the proxy: the page itself answers 404 in every production build (notFound()).
const matrix: Record<string, Record<string, PageAccess>> = {
  anonymous: {
    "/admin": to("/admin/sign-in"),
    "/admin/finance": to("/admin/sign-in?next=%2Fadmin%2Ffinance"),
    "/studio": to("/studio/sign-in"),
    "/studio/settings": to("/studio/sign-in?next=%2Fstudio%2Fsettings"),
    "/you": to("/sign-in?next=%2Fyou"),
    "/dev/components": pass,
  },
  shopper: {
    "/admin": to("/"),
    "/admin/finance": to("/"),
    "/studio": to("/sell"),
    "/studio/settings": to("/sell"),
    "/you": pass,
    "/dev/components": pass,
  },
  "brand member": {
    "/admin": to("/"),
    "/admin/finance": to("/"),
    "/studio": pass,
    "/studio/settings": pass,
    "/you": pass,
    "/dev/components": pass,
  },
  admin: {
    "/admin": pass,
    "/admin/finance": pass,
    "/studio": to("/studio/sign-in"),
    "/studio/settings": to("/studio/sign-in?next=%2Fstudio%2Fsettings"),
    "/you": to("/sign-in?next=%2Fyou"),
    "/dev/components": pass,
  },
}

describe("route access matrix (production)", () => {
  for (const [who, rows] of Object.entries(matrix)) {
    for (const [url, want] of Object.entries(rows)) {
      it(`${who} ${url} → ${want.kind === "pass" ? "served" : `${want.kind} ${(want as { to: string }).to}`}`, async () => {
        assert.deepEqual(await decide(personas[who], url), want)
      })
    }
  }

  it("an admin whose role lacks the section gets the calm no-access page in place", async () => {
    assert.deepEqual(await decide(personas.admin, "/admin/finance", { admin: { admin: true, permitted: false, signedIn: true } }), { kind: "rewrite", to: "/admin/no-access" })
  })

  it("a stale or forged admin cookie: signed in elsewhere → landing page, else the admin sign-in", async () => {
    assert.deepEqual(await decide({ ...personas.admin, admin: { admin: false, permitted: false, signedIn: false } }, "/admin/users"), to("/admin/sign-in?next=%2Fadmin%2Fusers"))
    assert.deepEqual(await decide({ ...personas.admin, cookies: { ...none, admin: true, shopper: true }, admin: { admin: false, permitted: false, signedIn: true } }, "/admin/users"), to("/"))
  })

  it("the server can't answer: the admin page fails closed to the sign-in", async () => {
    const p = { ...personas.admin }
    const out = await pageAccess({ path: "/admin", search: "", cookies: p.cookies, studioSignIn: null, ask: { admin: async () => null, studio: async () => null } })
    assert.deepEqual(out, to("/admin/sign-in"))
  })

  it("the admin sign-in page stays reachable for everyone", async () => {
    for (const who of Object.keys(personas)) assert.deepEqual(await decide(personas[who], "/admin/sign-in"), pass)
  })

  it("a shopper who belongs to a brand but has no Studio session signs in to Studio and comes back", async () => {
    const memberSignedOutOfStudio: Persona = { ...personas["brand member"], cookies: { ...none, shopper: true } }
    assert.deepEqual(await decide(memberSignedOutOfStudio, "/studio/orders"), to("/studio/sign-in?next=%2Fstudio%2Forders"))
  })

  it("Studio's public entry pages and the shop's public pages stay open", async () => {
    for (const who of Object.keys(personas)) {
      assert.deepEqual(await decide(personas[who], "/studio/sign-in"), pass)
      assert.deepEqual(await decide(personas[who], "/studio/onboarding"), pass)
      assert.deepEqual(await decide(personas[who], "/bag"), pass)
      assert.deepEqual(await decide(personas[who], "/sell"), pass)
    }
  })

  it("every private shopper page asks a signed-out visitor to sign in, keeping the query", async () => {
    for (const path of ["/you/orders", "/inbox", "/notifications", "/wishlist", "/following", "/checkout"]) {
      assert.deepEqual(await decide(personas.anonymous, path), to(`/sign-in?next=${encodeURIComponent(path)}`))
    }
    assert.deepEqual(await decide(personas.anonymous, "/inbox?support=1"), to(`/sign-in?next=${encodeURIComponent("/inbox?support=1")}`))
  })
})
