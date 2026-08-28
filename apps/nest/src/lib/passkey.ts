import { bytesToHex, hexToBytes, type Hex } from "viem";

/**
 * WebAuthn plumbing for the nest wallet: create a passkey (the key pair
 * lives in the device's secure enclave / platform keychain), and sign
 * account digests with it. The digest becomes the WebAuthn challenge;
 * the contract verifies the full assertion on-chain.
 */

const P256_N = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);

export type PasskeyAuth = {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeLocation: number;
  responseTypeLocation: number;
  r: string;
  s: string;
};

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Copy into a plain ArrayBuffer — the WebAuthn API rejects ArrayBufferLike views. */
function toBuf(u: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u.length);
  new Uint8Array(buf).set(u);
  return buf;
}

/** Create a platform passkey; returns credential id + P-256 public key. */
export async function createPasskey(
  label: string,
): Promise<{ credentialId: string; x: bigint; y: bigint }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "nest — .robin", id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: label,
        displayName: label,
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (P-256)
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey creation cancelled");

  const response = cred.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error("this browser can't export the passkey public key");
  const der = new Uint8Array(spki);
  // SubjectPublicKeyInfo for P-256 ends with the 65-byte uncompressed point.
  const point = der.slice(der.length - 65);
  if (point[0] !== 0x04) throw new Error("unexpected public key format");
  const x = BigInt(bytesToHex(point.slice(1, 33)));
  const y = BigInt(bytesToHex(point.slice(33, 65)));
  return { credentialId: b64url(new Uint8Array(cred.rawId)), x, y };
}

/** Parse an ASN.1 DER ECDSA signature into (r, s), normalizing s to low-s. */
function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error("bad signature");
  let offset = 2;
  if (der[1]! & 0x80) offset = 2 + (der[1]! & 0x7f);
  const readInt = (): bigint => {
    if (der[offset] !== 0x02) throw new Error("bad signature");
    const len = der[offset + 1]!;
    const bytes = der.slice(offset + 2, offset + 2 + len);
    offset += 2 + len;
    return BigInt(bytesToHex(bytes));
  };
  const r = readInt();
  let s = readInt();
  if (s > P256_N / 2n) s = P256_N - s;
  return { r, s };
}

/**
 * Recovery assertion: let the user pick their passkey (no stored pointer
 * needed — resident credentials are discoverable), then mathematically
 * recover the P-256 public key candidates from the signature itself.
 * ECDSA recovery yields two candidates; the caller disambiguates via
 * on-chain state or a second assertion.
 */
export async function assertForRecovery(): Promise<{
  credentialId: string;
  candidates: { x: bigint; y: bigint }[];
}> {
  const { p256 } = await import("@noble/curves/p256");
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuf(crypto.getRandomValues(new Uint8Array(32))),
      rpId: location.hostname,
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("recovery cancelled");
  const response = assertion.response as AuthenticatorAssertionResponse;

  const clientHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", response.clientDataJSON),
  );
  const authData = new Uint8Array(response.authenticatorData);
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData);
  signed.set(clientHash, authData.length);
  const msgHash = new Uint8Array(await crypto.subtle.digest("SHA-256", signed));

  // Raw (r, s) — do NOT low-s normalize here; recovery needs the original.
  const der = new Uint8Array(response.signature);
  if (der[0] !== 0x30) throw new Error("bad signature");
  let offset = 2;
  if (der[1]! & 0x80) offset = 2 + (der[1]! & 0x7f);
  const readInt = (): bigint => {
    const len = der[offset + 1]!;
    const bytes = der.slice(offset + 2, offset + 2 + len);
    offset += 2 + len;
    return BigInt(bytesToHex(bytes));
  };
  const r = readInt();
  const s = readInt();

  const candidates: { x: bigint; y: bigint }[] = [];
  for (const bit of [0, 1]) {
    try {
      const point = new p256.Signature(r, s)
        .addRecoveryBit(bit)
        .recoverPublicKey(msgHash)
        .toAffine();
      candidates.push({ x: point.x, y: point.y });
    } catch {
      // that recovery bit doesn't produce a valid point — skip
    }
  }
  if (candidates.length === 0) throw new Error("could not recover key");
  return { credentialId: b64url(new Uint8Array(assertion.rawId)), candidates };
}

/** Sign a 32-byte digest with the stored passkey (Face ID / fingerprint). */
export async function signWithPasskey(
  credentialId: string,
  digest: Hex,
): Promise<PasskeyAuth> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuf(hexToBytes(digest)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: toBuf(fromB64url(credentialId)) }],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("signing cancelled");

  const response = assertion.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const challengeLocation = clientDataJSON.indexOf('"challenge":"');
  const responseTypeLocation = clientDataJSON.indexOf('"type":"webauthn.get"');
  if (challengeLocation < 0 || responseTypeLocation < 0) {
    throw new Error("unexpected assertion format");
  }
  const { r, s } = parseDerSignature(new Uint8Array(response.signature));
  return {
    authenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
    clientDataJSON,
    challengeLocation,
    responseTypeLocation,
    r: r.toString(),
    s: s.toString(),
  };
}
