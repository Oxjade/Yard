import { createPublicKey, timingSafeEqual, verify as verifySignature, X509Certificate, type KeyObject } from "node:crypto"
import { decodeCBOR, type CBORType } from "@levischuck/tiny-cbor"
import { sha256 } from "./request"

/**
 * iOS: Apple App Attest (DeviceCheck), per Apple's "Validating apps that connect to your server".
 * Pure (Node crypto + tiny-cbor), so `tsx --test` runs it against a generated certificate chain.
 *
 * Attestation (once per install, POST /api/app/attest/register): the CBOR object's x5c chain ends
 * at Apple's App Attestation root; the leaf's 1.2.840.113635.100.8.2 extension holds
 * sha256(authData ‖ sha256(challenge)); the key id is sha256 of the leaf's public key and equals
 * the credential id; rpIdHash = sha256("TEAMID.bundleid"); the counter is 0; the aaguid names the
 * environment. Then the public key and counter are stored.
 *
 * Assertion (each protected request): the signature over sha256(authenticatorData ‖ clientDataHash)
 * verifies with the stored key, rpIdHash matches, and the counter is above the stored one.
 */

/** Apple App Attestation Root CA (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem). */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
`

export const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])
export const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop")

/** DER of OID 1.2.840.113635.100.8.2 (the App Attest nonce extension). */
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02])

export type Fail = { ok: false; reason: string }

/** tiny-cbor reads the whole underlying ArrayBuffer, so hand it a copy that starts at offset 0 (Buffers are often pool slices). */
const cbor = (b: Uint8Array): CBORType => decodeCBOR(new Uint8Array(b))

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b)

/* ---------- Minimal DER reading (just enough to find one certificate extension) ---------- */

type Tlv = { tag: number; start: number; end: number; next: number }

function tlv(buf: Buffer, at: number): Tlv {
  if (at + 2 > buf.length) throw new Error("DER: truncated")
  const tag = buf[at]!
  let len = buf[at + 1]!
  let p = at + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n < 1 || n > 4 || p + n > buf.length) throw new Error("DER: bad length")
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i]!
    p += n
  }
  if (p + len > buf.length) throw new Error("DER: truncated")
  return { tag, start: p, end: p + len, next: p + len }
}

function children(buf: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let at = parent.start; at < parent.end; ) {
    const c = tlv(buf, at)
    out.push(c)
    at = c.next
  }
  return out
}

/** The 32-byte nonce in a credential certificate's App Attest extension, or null. */
export function attestNonceOf(certDer: Buffer): Buffer | null {
  const cert = tlv(certDer, 0)
  const tbs = children(certDer, cert)[0]
  if (!tbs) return null
  const extsWrapper = children(certDer, tbs).find((c) => c.tag === 0xa3)
  if (!extsWrapper) return null
  const exts = children(certDer, extsWrapper)[0]
  if (!exts) return null
  for (const ext of children(certDer, exts)) {
    const parts = children(certDer, ext)
    const oid = parts[0]
    if (!oid || !certDer.subarray(oid.start - 2, oid.end).equals(NONCE_OID)) continue
    const value = parts[parts.length - 1]!
    if (value.tag !== 0x04) return null
    // extnValue: SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
    const seq = tlv(certDer, value.start)
    const tagged = children(certDer, seq).find((c) => c.tag === 0xa1)
    if (!tagged) return null
    const octets = tlv(certDer, tagged.start)
    if (octets.tag !== 0x04) return null
    return Buffer.from(certDer.subarray(octets.start, octets.end))
  }
  return null
}

/* ---------- authenticator data ---------- */

export type AuthData = { rpIdHash: Buffer; flags: number; counter: number; aaguid: Buffer | null; credentialId: Buffer | null }

export function parseAuthData(b: Buffer): AuthData {
  if (b.length < 37) throw new Error("authData too short")
  const out: AuthData = { rpIdHash: b.subarray(0, 32), flags: b[32]!, counter: b.readUInt32BE(33), aaguid: null, credentialId: null }
  if (b.length >= 55) {
    out.aaguid = b.subarray(37, 53)
    const n = b.readUInt16BE(53)
    if (55 + n > b.length) throw new Error("authData credentialId truncated")
    out.credentialId = b.subarray(55, 55 + n)
  }
  return out
}

/* ---------- attestation ---------- */

const bytes = (v: CBORType | undefined): Buffer | null => (v instanceof Uint8Array ? Buffer.from(v) : null)

/** The uncompressed EC point (0x04 ‖ x ‖ y) of a P-256 public key. */
function ecPoint(key: KeyObject): Buffer | null {
  const jwk = key.export({ format: "jwk" })
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) return null
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])
}

export type AttestationInput = {
  /** The attestation object (CBOR) as the app received it from attestKey. */
  attestation: Buffer
  /** The key id from generateKey (base64 of sha256 of the public key). */
  keyId: string
  /** The challenge the server issued; the app attested sha256(challenge) as clientDataHash. */
  challenge: string
  appId: string
  environment: "production" | "development"
  rootPem?: string
  now?: Date
}

export type AttestationResult = { ok: true; publicKeyPem: string; counter: number; receipt: Buffer | null } | Fail

export function verifyAttestation(input: AttestationInput): AttestationResult {
  let obj: CBORType
  try {
    obj = cbor(input.attestation)
  } catch {
    return { ok: false, reason: "cbor" }
  }
  if (!(obj instanceof Map)) return { ok: false, reason: "cbor" }
  if (obj.get("fmt") !== "apple-appattest") return { ok: false, reason: "format" }
  const stmt = obj.get("attStmt")
  const authDataRaw = bytes(obj.get("authData"))
  if (!(stmt instanceof Map) || !authDataRaw) return { ok: false, reason: "cbor" }
  const x5c = stmt.get("x5c")
  if (!Array.isArray(x5c) || x5c.length < 2) return { ok: false, reason: "x5c" }
  const ders = x5c.map(bytes)
  if (ders.some((d) => !d)) return { ok: false, reason: "x5c" }

  // 1. The chain: credential certificate ← intermediate ← Apple's root, each within its dates.
  let leaf: X509Certificate, inter: X509Certificate, root: X509Certificate
  try {
    leaf = new X509Certificate(ders[0]!)
    inter = new X509Certificate(ders[1]!)
    root = new X509Certificate(input.rootPem ?? APPLE_APP_ATTEST_ROOT_PEM)
  } catch {
    return { ok: false, reason: "certificate" }
  }
  const now = input.now ?? new Date()
  const within = (c: X509Certificate) => now >= new Date(c.validFrom) && now <= new Date(c.validTo)
  if (!inter.ca || !inter.checkIssued(root) || !inter.verify(root.publicKey)) return { ok: false, reason: "chain" }
  if (!leaf.checkIssued(inter) || !leaf.verify(inter.publicKey)) return { ok: false, reason: "chain" }
  if (!within(leaf) || !within(inter) || !within(root)) return { ok: false, reason: "chain_dates" }

  // 2–4. nonce = sha256(authData ‖ sha256(challenge)) and the certificate's extension holds it.
  const nonce = sha256(Buffer.concat([authDataRaw, sha256(input.challenge)]))
  let certNonce: Buffer | null
  try {
    certNonce = attestNonceOf(Buffer.from(leaf.raw))
  } catch {
    certNonce = null
  }
  if (!certNonce || !same(certNonce, nonce)) return { ok: false, reason: "nonce" }

  // 5. The key id is sha256 of the credential's public key.
  const point = ecPoint(leaf.publicKey)
  if (!point) return { ok: false, reason: "key_type" }
  const keyHash = sha256(point)
  const keyId = Buffer.from(input.keyId, "base64")
  if (!same(keyHash, keyId)) return { ok: false, reason: "key_id" }

  let ad: AuthData
  try {
    ad = parseAuthData(authDataRaw)
  } catch {
    return { ok: false, reason: "auth_data" }
  }
  // 6. Our app: rpIdHash = sha256("TEAMID.bundleid").
  if (!same(ad.rpIdHash, sha256(input.appId))) return { ok: false, reason: "app_id" }
  // 7. A fresh key: counter 0.
  if (ad.counter !== 0) return { ok: false, reason: "counter" }
  // 8. The environment.
  const aaguid = input.environment === "development" ? AAGUID_DEVELOPMENT : AAGUID_PRODUCTION
  if (!ad.aaguid || !ad.aaguid.equals(aaguid)) return { ok: false, reason: "environment" }
  // 9. The credential id is the key id.
  if (!ad.credentialId || !same(ad.credentialId, keyHash)) return { ok: false, reason: "credential_id" }

  return { ok: true, publicKeyPem: leaf.publicKey.export({ type: "spki", format: "pem" }).toString(), counter: 0, receipt: bytes(stmt.get("receipt")) }
}

/* ---------- assertion ---------- */

export type AssertionInput = { assertion: Buffer; clientDataHash: Buffer; publicKeyPem: string; storedCounter: number; appId: string }

export type AssertionResult = { ok: true; counter: number } | Fail

export function verifyAssertion(input: AssertionInput): AssertionResult {
  let obj: CBORType
  try {
    obj = cbor(input.assertion)
  } catch {
    return { ok: false, reason: "cbor" }
  }
  if (!(obj instanceof Map)) return { ok: false, reason: "cbor" }
  const signature = bytes(obj.get("signature"))
  const authDataRaw = bytes(obj.get("authenticatorData"))
  if (!signature || !authDataRaw) return { ok: false, reason: "cbor" }
  const nonce = sha256(Buffer.concat([authDataRaw, input.clientDataHash]))
  let valid = false
  try {
    valid = verifySignature("sha256", nonce, createPublicKey(input.publicKeyPem), signature)
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: "signature" }
  let ad: AuthData
  try {
    ad = parseAuthData(authDataRaw)
  } catch {
    return { ok: false, reason: "auth_data" }
  }
  if (!same(ad.rpIdHash, sha256(input.appId))) return { ok: false, reason: "app_id" }
  if (ad.counter <= input.storedCounter) return { ok: false, reason: "counter_replay" }
  return { ok: true, counter: ad.counter }
}
