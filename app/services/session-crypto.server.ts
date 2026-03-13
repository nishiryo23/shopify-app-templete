import crypto from "node:crypto";
import { Session } from "@shopify/shopify-app-react-router/server";

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function parseShopTokenEncryptionKey(encodedKey: string | undefined) {
  if (!encodedKey) {
    return null;
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error("SHOP_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }

  return key;
}

let shopTokenEncryptionKey: Buffer | null | undefined;

function getShopTokenEncryptionKey() {
  if (shopTokenEncryptionKey !== undefined) {
    return shopTokenEncryptionKey;
  }

  shopTokenEncryptionKey = parseShopTokenEncryptionKey(
    process.env.SHOP_TOKEN_ENCRYPTION_KEY,
  );
  return shopTokenEncryptionKey;
}

export function hasShopTokenEncryptionKey() {
  return getShopTokenEncryptionKey() !== null;
}

function requireShopTokenEncryptionKey() {
  const key = getShopTokenEncryptionKey();

  if (!key) {
    throw new Error("SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage");
  }

  return key;
}

function encryptJson(value: unknown): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", requireShopTokenEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptJson(payload: EncryptedPayload) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    requireShopTokenEncryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

export function encryptOfflineSession(session: Session) {
  if (session.isOnline) {
    throw new Error("Expected offline session");
  }

  return encryptJson(session.toPropertyArray(true));
}

export function decryptOfflineSession(payload: EncryptedPayload) {
  const sessionEntries = decryptJson(payload) as [string, string | number | boolean][];
  return Session.fromPropertyArray(sessionEntries, true);
}
