#!/usr/bin/env node
import { pathToFileURL } from "node:url"

const TAG = `t_section_e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const results = []

function check(name, passed, detail = "") {
  const result = { status: passed ? "PASS" : "FAIL", name, detail: String(detail).slice(0, 300) }
  results.push(result)
  console.log(`${result.status} ${name}${result.detail ? ` — ${result.detail}` : ""}`)
}

async function run(options = {}) {
  const base = (options.base ?? process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
  let cookie = ""

  async function request(method, path, { body, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Origin: base,
        "X-Yard-Client": "1",
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {}
    return { status: response.status, data, text, headers: response.headers }
  }

  const get = (path) => request("GET", path)
  const post = (path, body, headers) => request("POST", path, { body, headers })
  const patch = (path, body) => request("PATCH", path, { body })
  const del = (path, body) => request("DELETE", path, { body })

  try {
    const login = await post("/api/auth/demo", { actor: "brand", account: "u_b_tobi", brandId: "b_lagos_static" })
    const cookies = login.headers?.getSetCookie?.() ?? []
    cookie = cookies.map((value) => value.split(";")[0]).join("; ")
    check("brand session is available", login.status === 200 && !!cookie, `${login.status}`)
    if (login.status !== 200 || !cookie) return results

    const products = await get("/api/catalog/products?brand=b_lagos_static&limit=3")
    const productIds = (products.data?.products ?? []).map((product) => product.id)
    const foreignProducts = await get("/api/catalog/products?brand=b_null_form&limit=1")
    const foreignProductId = foreignProducts.data?.products?.[0]?.id
    check("seeded products are available for ordering", products.status === 200 && productIds.length >= 2, `${productIds.length}`)
    if (products.status !== 200 || productIds.length < 2 || !foreignProductId) return results

    const createBody = { name: `${TAG} collection`, description: "Section E acceptance", status: "published" }
    const createHeaders = { "Idempotency-Key": `${TAG}_create` }
    const [createA, createB] = await Promise.all([
      post("/api/studio/catalog/collections", createBody, createHeaders),
      post("/api/studio/catalog/collections", createBody, createHeaders),
    ])
    const collection = createA.data?.collection
    check("concurrent same-key creates return one collection", createA.status === 201 && createB.status === 201 && collection?.id === createB.data?.collection?.id, `${createA.status}/${createB.status}`)
    if (!collection) return results

    const orderedIds = productIds.slice(0, 3).reverse()
    const saved = await patch(`/api/studio/catalog/collections/${collection.id}`, {
      name: `${TAG} reordered`,
      description: "Saved atomically",
      productIds: orderedIds,
      expectedVersion: collection.version,
    })
    const savedCollection = saved.data?.collection
    check("PATCH saves metadata and product order in one version", saved.status === 200 && savedCollection?.version === collection.version + 1 && savedCollection?.name === `${TAG} reordered` && JSON.stringify(savedCollection?.productIds) === JSON.stringify(orderedIds), `${saved.status}`)

    if (savedCollection) {
      const rejected = await patch(`/api/studio/catalog/collections/${collection.id}`, {
        name: `${TAG} must roll back`,
        productIds: [...orderedIds, foreignProductId],
        expectedVersion: savedCollection.version,
      })
      const listed = await get("/api/studio/catalog/collections")
      const afterRejected = listed.data?.collections?.find((item) => item.id === collection.id)
      check("invalid product PATCH rolls back name, order, and version", rejected.status === 400 && afterRejected?.name === savedCollection.name && afterRejected?.version === savedCollection.version && JSON.stringify(afterRejected?.productIds) === JSON.stringify(orderedIds), `${rejected.status}`)

      const stale = await patch(`/api/studio/catalog/collections/${collection.id}`, { name: `${TAG} stale`, expectedVersion: collection.version })
      check("stale collection PATCH returns 409", stale.status === 409, `${stale.status}`)

      const publicCollection = await get(`/api/catalog/storefronts/b_lagos_static/collections/${collection.handle}`)
      check("public collection preserves saved product order", publicCollection.status === 200 && JSON.stringify(publicCollection.data?.collection?.productIds) === JSON.stringify(orderedIds), `${publicCollection.status}`)

      const draft = await patch(`/api/studio/catalog/collections/${collection.id}`, { status: "draft", expectedVersion: savedCollection.version })
      const hidden = await get(`/api/catalog/storefronts/b_lagos_static/collections/${collection.handle}`)
      check("draft collection is hidden from the public storefront", draft.status === 200 && hidden.status === 404, `${draft.status}/${hidden.status}`)

      const removed = await del(`/api/studio/catalog/collections/${collection.id}`, { expectedVersion: draft.data?.collection?.version })
      check("collection delete succeeds with the current version", removed.status === 200, `${removed.status}`)
    }
  } catch (error) {
    check("collection acceptance completed", false, error instanceof Error ? error.message : String(error))
  } finally {
    if (cookie) {
      try {
        const listed = await get("/api/studio/catalog/collections")
        for (const item of listed.data?.collections ?? []) {
          if (item.name.startsWith(TAG)) await del(`/api/studio/catalog/collections/${item.id}`, { expectedVersion: item.version })
        }
        const afterCleanup = await get("/api/studio/catalog/collections")
        check("tagged acceptance collections are cleaned up", !(afterCleanup.data?.collections ?? []).some((item) => item.name.startsWith(TAG)))
      } catch (error) {
        check("tagged acceptance collections are cleaned up", false, error instanceof Error ? error.message : String(error))
      }
    }
  }
  return results
}

export default run

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await run()
  process.exitCode = output.some((item) => item.status === "FAIL") ? 1 : 0
}