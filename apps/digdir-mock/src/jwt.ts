// Minimal RS256 JWT, on node:crypto alone.
//
// The sandbox does not add runtime dependencies, and a JWT is three base64url
// segments with one signature over the first two. Pulling in a library for that
// would hide exactly the mechanics the workshop is meant to show.
//
// Deliberately not implemented: alg negotiation (RS256 only), encrypted tokens,
// and "alg": "none". A token whose header asks for anything but RS256 is rejected
// rather than trusted - accepting the header's word for the algorithm is the
// classic JWT vulnerability, and failing closed here is cheaper than explaining it.

import { createSign, createVerify, createPublicKey } from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";

/** A key this module can sign with. PEM string or a KeyObject, plus the kid to advertise. */
export type SigningKey = {
  kid: string;
  privateKey: string | KeyObject;
};

export type JwtHeader = {
  alg?: string;
  typ?: string;
  kid?: string;
  [felt: string]: unknown;
};

/**
 * Claims are left open. The set differs per issuer and per grant - Maskinporten has
 * `scope` and `consumer`, ID-porten has `pid` and `acr` - and the resource server
 * is where a claim gets a meaning. See autentisering.ts in sandbox-backend.
 */
export type JwtClaims = Record<string, any>;

export type DecodedJwt = {
  header: JwtHeader;
  payload: JwtClaims;
  /** The `header.payload` string the signature covers. */
  signingInput: string;
  signature: Buffer;
};

function b64urlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function b64urlDecode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

export function signJwt(krav: JwtClaims, { kid, privateKey }: SigningKey): string {
  const header: JwtHeader = { alg: "RS256", typ: "JWT", kid };
  const signingInput =
    `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(krav))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Header and payload without checking the signature. For the issuer reading a
 * client's assertion, and for a resource server that needs the `kid` before it can
 * pick a key. Never use the payload from this for an access decision.
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Token har ikke tre segmenter.");
  }
  try {
    return {
      header: JSON.parse(b64urlDecode(parts[0])),
      payload: JSON.parse(b64urlDecode(parts[1])),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], "base64url")
    };
  } catch (feil) {
    throw new Error(`Token kunne ikke dekodes: ${(feil as Error).message}`);
  }
}

/**
 * Verifies the signature against a JWK. Returns the claims, or throws.
 *
 * Claim checks - iss, aud, exp - are the caller's job on purpose. They differ per
 * resource server, and burying them here would make them invisible at the place
 * where the access decision is actually made.
 */
export function verifyJwt(token: string, jwk: JsonWebKey): JwtClaims {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== "RS256") {
    throw new Error(`Forventet alg RS256, fikk ${header.alg}.`);
  }
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const valid = createVerify("RSA-SHA256").update(signingInput).verify(publicKey, signature);
  if (!valid) {
    throw new Error("Signaturen stemmer ikke med nøkkelen.");
  }
  return payload;
}
