import { randomBytes } from "node:crypto"
import { and, eq, gt, lt, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { appAttestChallenges, appAttestKeys } from "../db/schema/app-attest"
import { sha256Hex } from "./request"

/**
 * The database half of app attestation, without "server-only", so the tests run these exact
 * statements on PGlite with the migrations (app-attest.test.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>
export type ChallengePurpose = "request" | "register"

export const CHALLENGE_TTL_MS = 5 * 60_000

/** A new challenge (32 random bytes, base64url). Only its sha256 is stored. Sweeps expired ones. */
export async function issueChallenge(d: Db, purpose: ChallengePurpose, now = new Date()): Promise<{ challenge: string; expiresAt: Date }> {
  const challenge = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS)
  await d.delete(appAttestChallenges).where(lt(appAttestChallenges.expiresAt, now))
  await d.insert(appAttestChallenges).values({ hash: sha256Hex(challenge), purpose, expiresAt, createdAt: now })
  return { challenge, expiresAt }
}

/** Uses up a challenge: true once, for an unexpired challenge of this purpose; false ever after. */
export async function consumeChallenge(d: Db, challenge: string, purpose: ChallengePurpose, now = new Date()): Promise<boolean> {
  const rows = await d
    .delete(appAttestChallenges)
    .where(and(eq(appAttestChallenges.hash, sha256Hex(challenge)), eq(appAttestChallenges.purpose, purpose), gt(appAttestChallenges.expiresAt, now)))
    .returning({ hash: appAttestChallenges.hash })
  return rows.length === 1
}

export type StoredKey = { keyId: string; publicKey: string; counter: number; environment: string }

export async function getKey(d: Db, keyId: string): Promise<StoredKey | null> {
  const [row] = await d.select({ keyId: appAttestKeys.keyId, publicKey: appAttestKeys.publicKey, counter: appAttestKeys.counter, environment: appAttestKeys.environment }).from(appAttestKeys).where(eq(appAttestKeys.keyId, keyId)).limit(1)
  return row ?? null
}

/** Stores a verified key. A key id seen before keeps its row (an attestation can't reset the counter). */
export async function saveKey(d: Db, k: { keyId: string; publicKey: string; environment: string; userId: string | null }, now = new Date()): Promise<"created" | "exists"> {
  const rows = await d.insert(appAttestKeys).values({ keyId: k.keyId, publicKey: k.publicKey, counter: 0, environment: k.environment, userId: k.userId, createdAt: now }).onConflictDoNothing().returning({ keyId: appAttestKeys.keyId })
  return rows.length ? "created" : "exists"
}

/**
 * Moves the counter up to `counter` only if it is still below it (compare-and-set), so two
 * requests carrying the same assertion can't both pass. False: replayed or raced.
 */
export async function advanceCounter(d: Db, keyId: string, counter: number, userId: string | null, now = new Date()): Promise<boolean> {
  const rows = await d
    .update(appAttestKeys)
    .set({ counter, lastUsedAt: now, userId: sql`coalesce(${userId}::text, ${appAttestKeys.userId})` })
    .where(and(eq(appAttestKeys.keyId, keyId), lt(appAttestKeys.counter, counter)))
    .returning({ keyId: appAttestKeys.keyId })
  return rows.length === 1
}
