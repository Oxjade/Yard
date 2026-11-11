# Gates: Section E Studio collections

Scope: real-brand collections are versioned in Studio and render publicly in saved product order.

- [x] G1: TypeScript validation passes
  CHECK: npx tsc --noEmit && node -e "console.log('TYPECHECK PASSED')"
  EXPECT: TYPECHECK PASSED
  EVIDENCE: passed after final edits

- [x] G2: Focused lint passes for changed collection files
  CHECK: npx eslint src/server/catalog/contracts.ts src/server/catalog/studio.ts src/server/db/schema/catalog.ts src/lib/api/client.ts src/lib/api/contracts/catalog.ts src/lib/data/types.ts src/components/studio/catalog/collections-view.tsx src/components/studio/catalog/collection-dialog.tsx src/components/studio/catalog/live.ts src/components/studio/catalog/page-copy.ts src/components/storefront/collection-view.tsx 'src/app/(market)/brands/[handle]/collections/[collection]/page.tsx' 'src/app/(market)/brands/[handle]/collections/[collection]/layout.tsx' 'src/app/api/studio/catalog/collections/route.ts' 'src/app/api/studio/catalog/collections/[id]/route.ts' 'src/app/api/studio/catalog/collections/[id]/products/route.ts' scripts/checks/v3-catalog.mjs scripts/checks/v3-collections.mjs && node -e "console.log('COLLECTION LINT PASSED')"
  EXPECT: COLLECTION LINT PASSED
  EVIDENCE: ESLint and both acceptance-script syntax checks passed after final edits

- [x] G3: Collection schema migration applies and focused database checks pass
  CHECK: npx drizzle-kit check && npm run db:check -- v3-collections && node -e "console.log('DATABASE CHECK PASSED')"
  EXPECT: migrations are aligned; `v3-collections` and the database self-check pass
  EVIDENCE: migration check passed; database self-check and collection acceptance reported 29 passed, 0 failed, 0 skipped

- [ ] G4: Studio create, reorder, publish, rename, delete, and stale-write reload flow works
  EVIDENCE: demo tray create, reorder, rename, Draft status, save, and delete passed in browser; API acceptance verified stale writes return 409. Live-session Reload-toast interaction remains unverified because the available browser session is demo-only.

- [x] G5: A published Studio collection renders on the public brand page in saved product order
  EVIDENCE: browser rendered a temporary published collection with Danfo Heavyweight Hoodie before Static Moto Jacket, matching its saved productIds; the test collection was deleted afterward