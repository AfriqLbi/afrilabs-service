import * as crypto from "crypto";

/**
 * Signed link tokens for guest pay links (spec §7.1, §10).
 *
 * Token format:  base64url(payload).base64url(signature)
 * Payload:      { orderId, quoteVersion?, exp }
 *
 * The token is scoped to a single order and carries an expiry.  It is
 * verified server-side before allowing a guest to initiate payment.
 */

export interface LinkTokenPayload {
  orderId: string;
  quoteVersion?: number;
  exp: number; // unix ms
}

function sign(payload: LinkTokenPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data.toString("base64url")}.${sig.toString("base64url")}`;
}

export function createLinkToken(
  payload: Omit<LinkTokenPayload, "exp"> & { exp?: number },
  secret: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
): string {
  return sign(
    { ...payload, exp: payload.exp ?? Date.now() + ttlMs },
    secret,
  );
}

export function verifyLinkToken(
  token: string,
  secret: string,
): LinkTokenPayload {
  const [dataB64, sigB64] = token.split(".");
  if (!dataB64 || !sigB64) throw new Error("Malformed link token");

  const data = Buffer.from(dataB64, "base64url");
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest();

  const providedSig = Buffer.from(sigB64, "base64url");
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new Error("Invalid link token signature");
  }

  const payload = JSON.parse(data.toString()) as LinkTokenPayload;
  if (payload.exp < Date.now()) throw new Error("Link token expired");

  return payload;
}
