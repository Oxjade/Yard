import { jsonLdGraph, serializeJsonLd, type JsonLdNode } from "@/lib/seo/json-ld"

/**
 * The page's structured data: one <script type="application/ld+json"> holding every node in a
 * single @graph, rendered on the server into the HTML (Next's JSON-LD guide: a native script tag in
 * the page, "<" escaped). Builders live in src/lib/seo/json-ld.ts.
 */
export function JsonLd({ nodes }: { nodes: (JsonLdNode | null | undefined | false)[] }) {
  const graph = jsonLdGraph(nodes)
  if (!(graph["@graph"] as unknown[]).length) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />
}
