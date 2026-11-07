import { connection, type NextRequest } from "next/server"
import { getEnv } from "@/server/env"
import { json, route } from "@/server/http/route"
import { createFixtures, removeFixtures } from "@/server/inbox/fixtures"
import { fixturesCreateBody, fixturesRemoveBody } from "@/server/inbox/fixtures-body"

/**
 * Development only (404 in production; admin with audit.view, like /api/dev/reseed). The seeded
 * state holds only the sample conversations, so a kit creates its fixed-id test conversations
 * first and removes what its test shoppers left last (§9.0 test-data hygiene):
 *   POST   { sets: ["i"], run?, force? }  → cv_t_i1_ls, cv_t_i2_ls, cv_t_i3_or (m1: cv_t_m1_ls; m2: cv_t_m2_*; f1: cv_t_f1_ls);
 *          409 while another run (a different `run` tag) started less than 15 minutes ago, unless force
 *   DELETE { sets: ["i"], since?, reasonPrefix? }
 *          → every conversation, photo, bell item, block, spam mark, abuse alert, restriction and
 *            message_started signal of those sets' test shoppers; with `since`, the inbox module's
 *            dev.reseeded audit rows from then on; with `reasonPrefix` (must start "I kit:"), the
 *            decisions the kit made on the sets' own accounts to show a state (restrictions, their
 *            audit rows and notifications). Both write a dev.fixtures_* audit row.
 */
const rate = { key: "inbox.dev.fixtures", limit: 30, windowSec: 60 }

const post = route({ auth: "admin", permission: "audit.view", body: fixturesCreateBody, maxBody: 1024, rate }, async ({ actor, body }) =>
  json(await createFixtures([...new Set(body.sets)], { run: body.run, force: body.force, by: { id: actor.userId, name: actor.name, role: actor.role } }), 201),
)
const del = route({ auth: "admin", permission: "audit.view", body: fixturesRemoveBody, maxBody: 1024, rate }, async ({ actor, body }) =>
  json(await removeFixtures([...new Set(body.sets)], { since: body.since, reasonPrefix: body.reasonPrefix, by: { id: actor.userId, name: actor.name, role: actor.role } })),
)

const notFound = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return post(req, ctx)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return del(req, ctx)
}
