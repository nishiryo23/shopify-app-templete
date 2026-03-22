import crypto from "node:crypto";

export const PRODUCT_EXPORT_DOWNLOAD_TOKEN_TTL_SECONDS = 60;

/**
 * @param {{ exp: number; jobId: string; shopDomain: string }} payload
 */
function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function requireSecret(secret = process.env.SHOPIFY_API_SECRET || "") {
  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is required to issue product export download tokens");
  }

  return secret;
}

/**
 * @param {{
 *   expiresInSeconds?: number;
 *   jobId: string;
 *   now?: number;
 *   secret?: string;
 *   shopDomain: string;
 * }} args
 */
export function issueProductExportDownloadToken({
  expiresInSeconds = PRODUCT_EXPORT_DOWNLOAD_TOKEN_TTL_SECONDS,
  jobId,
  now = Date.now(),
  secret,
  shopDomain,
} = {}) {
  const signingSecret = requireSecret(secret);
  const payload = encodePayload({
    exp: Math.floor(now / 1000) + expiresInSeconds,
    jobId: String(jobId ?? ""),
    shopDomain: String(shopDomain ?? ""),
  });

  return `${payload}.${signPayload(payload, signingSecret)}`;
}

/**
 * @param {string} token
 * @param {{ now?: number; secret?: string }} args
 */
export function verifyProductExportDownloadToken(token, { now = Date.now(), secret } = {}) {
  const signingSecret = requireSecret(secret);

  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".", 2);
  const expectedSignature = signPayload(payload, signingSecret);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  let decoded;

  try {
    decoded = decodePayload(payload);
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== "object") {
    return null;
  }

  if (typeof decoded.exp !== "number" || decoded.exp < Math.floor(now / 1000)) {
    return null;
  }

  if (typeof decoded.jobId !== "string" || typeof decoded.shopDomain !== "string") {
    return null;
  }

  return decoded;
}
