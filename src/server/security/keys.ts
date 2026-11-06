import "server-only"
import { hkdfSync } from "node:crypto"
import { getEnv } from "../env"
import { yard } from "../state"

/**
 * One HKDF-SHA256 subkey per purpose, so no secret does two jobs (§5.5). Rotating
 * YARD_SESSION_SECRET invalidates sessions, OAuth states, quote tokens and anon cookies and
 * starts a new IP-hash series; YARD_ENCRYPTION_KEY only seals social tokens.
 */
export type Keys = {
  session: Buffer
  oauthState: Buffer
  ip: Buffer
  quote: Buffer
  anon: Buffer
  vault: Buffer
  /** Decrypt-only during a rotation of YARD_ENCRYPTION_KEY. */
  vaultPrevious: Buffer | null
}

const derive = (ikm: Buffer, info: string) => Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), info, 32))

export function keys(): Keys {
  return (yard.keys ??= (() => {
    const env = getEnv()
    return {
      session: derive(env.sessionSecret, "yard/session/v1"),
      oauthState: derive(env.sessionSecret, "yard/oauth-state/v1"),
      ip: derive(env.sessionSecret, "yard/ip/v1"),
      quote: derive(env.sessionSecret, "yard/quote/v1"),
      anon: derive(env.sessionSecret, "yard/anon/v1"),
      vault: derive(env.encryptionKey, "yard/social-tokens/v1"),
      vaultPrevious: env.encryptionKeyPrevious ? derive(env.encryptionKeyPrevious, "yard/social-tokens/v1") : null,
    } satisfies Keys
  })()) as Keys
}
