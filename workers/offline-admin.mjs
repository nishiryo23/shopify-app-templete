import crypto from "node:crypto";

import { Prisma } from "@prisma/client";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  Session,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

export class MissingOfflineSessionError extends Error {
  constructor(shopDomain) {
    super("missing-offline-session");
    this.name = "MissingOfflineSessionError";
    this.shopDomain = shopDomain;
  }
}

class WorkerShopSessionStorage {
  constructor(prisma, { onlineStorage } = {}) {
    this.prisma = prisma;
    this.onlineStorage = onlineStorage ?? new PrismaSessionStorage(prisma);
  }

  async clearOfflineSessionReference(where) {
    await this.prisma.shop.updateMany({
      where,
      data: {
        encryptedOfflineSession: Prisma.JsonNull,
        offlineSessionId: null,
      },
    });
  }

  async storeSession(session) {
    if (session.isOnline) {
      return this.onlineStorage.storeSession(session);
    }

    if (!hasShopTokenEncryptionKey()) {
      return this.onlineStorage.storeSession(session);
    }

    const encryptedOfflineSession = encryptOfflineSession(session);
    await this.prisma.shop.upsert({
      where: { shopDomain: session.shop },
      update: {
        encryptedOfflineSession,
        offlineSessionId: session.id,
      },
      create: {
        shopDomain: session.shop,
        encryptedOfflineSession,
        grantedScopes: [],
        offlineSessionId: session.id,
      },
    });
    await this.onlineStorage.deleteSession(session.id);

    return true;
  }

  async loadSession(id) {
    const prismaSession = await this.onlineStorage.loadSession(id);

    if (prismaSession?.isOnline) {
      return prismaSession;
    }

    if (!hasShopTokenEncryptionKey()) {
      return prismaSession ?? undefined;
    }

    const offlineShop = await this.prisma.shop.findUnique({
      where: { offlineSessionId: id },
      select: {
        encryptedOfflineSession: true,
        offlineSessionId: true,
        shopDomain: true,
      },
    });

    if (
      !offlineShop?.offlineSessionId ||
      !offlineShop.encryptedOfflineSession ||
      typeof offlineShop.encryptedOfflineSession !== "object" ||
      Array.isArray(offlineShop.encryptedOfflineSession)
    ) {
      return prismaSession ?? undefined;
    }

    try {
      return decryptOfflineSession(offlineShop.encryptedOfflineSession);
    } catch {
      await this.clearOfflineSessionReference({ offlineSessionId: id });
      return prismaSession ?? undefined;
    }
  }

  async deleteSession(id) {
    await this.onlineStorage.deleteSession(id);
    await this.clearOfflineSessionReference({ offlineSessionId: id });
    return true;
  }

  async deleteSessions(ids) {
    await this.onlineStorage.deleteSessions(ids);
    await this.clearOfflineSessionReference({ offlineSessionId: { in: ids } });
    return true;
  }

  async findSessionsByShop(shop) {
    const sessions = await this.onlineStorage.findSessionsByShop(shop);

    if (!hasShopTokenEncryptionKey()) {
      return sessions;
    }

    const offlineShop = await this.prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: {
        encryptedOfflineSession: true,
        offlineSessionId: true,
      },
    });

    if (
      offlineShop?.offlineSessionId &&
      offlineShop.encryptedOfflineSession &&
      typeof offlineShop.encryptedOfflineSession === "object" &&
      !Array.isArray(offlineShop.encryptedOfflineSession)
    ) {
      try {
        const decryptedOfflineSession = decryptOfflineSession(offlineShop.encryptedOfflineSession);
        const legacyOfflineSessionIndex = sessions.findIndex(
          (session) => !session.isOnline && session.id === decryptedOfflineSession.id,
        );

        if (legacyOfflineSessionIndex >= 0) {
          sessions.splice(legacyOfflineSessionIndex, 1);
        }

        sessions.push(decryptedOfflineSession);
      } catch {
        await this.clearOfflineSessionReference({ shopDomain: shop });
      }
    }

    return sessions;
  }

  isReady() {
    return this.onlineStorage.isReady();
  }
}

function parseShopTokenEncryptionKey(encodedKey) {
  if (!encodedKey) {
    return null;
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("SHOP_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }

  return key;
}

let cachedShopTokenEncryptionKey;

function hasShopTokenEncryptionKey() {
  if (cachedShopTokenEncryptionKey !== undefined) {
    return cachedShopTokenEncryptionKey !== null;
  }

  cachedShopTokenEncryptionKey = parseShopTokenEncryptionKey(process.env.SHOP_TOKEN_ENCRYPTION_KEY);
  return cachedShopTokenEncryptionKey !== null;
}

function requireShopTokenEncryptionKey() {
  if (cachedShopTokenEncryptionKey !== undefined) {
    if (!cachedShopTokenEncryptionKey) {
      throw new Error("SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage");
    }

    return cachedShopTokenEncryptionKey;
  }

  cachedShopTokenEncryptionKey = parseShopTokenEncryptionKey(process.env.SHOP_TOKEN_ENCRYPTION_KEY);
  if (!cachedShopTokenEncryptionKey) {
    throw new Error("SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage");
  }

  return cachedShopTokenEncryptionKey;
}

function encryptOfflineSession(session) {
  if (session.isOnline) {
    throw new Error("Expected offline session");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", requireShopTokenEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(session.toPropertyArray(true)), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptOfflineSession(payload) {
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

  return Session.fromPropertyArray(JSON.parse(plaintext.toString("utf8")), true);
}

let cachedPrisma = null;
let cachedShopify = null;

export function resetWorkerOfflineAdminCaches() {
  cachedPrisma = null;
  cachedShopify = null;
  cachedShopTokenEncryptionKey = undefined;
}

export function createWorkerShopSessionStorage(prisma, options) {
  return new WorkerShopSessionStorage(prisma, options);
}

function getWorkerShopify(prisma) {
  if (cachedShopify && cachedPrisma === prisma) {
    return cachedShopify;
  }

  cachedPrisma = prisma;
  cachedShopify = shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.January26,
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    scopes: process.env.SCOPES?.split(","),
    sessionStorage: new WorkerShopSessionStorage(prisma),
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });

  return cachedShopify;
}

export async function loadOfflineAdminContext({
  prisma,
  shopDomain,
}) {
  const sessions = await new WorkerShopSessionStorage(prisma).findSessionsByShop(shopDomain);
  const offlineSession = sessions.find((session) => !session.isOnline);

  if (!offlineSession) {
    throw new MissingOfflineSessionError(shopDomain);
  }
  const shopify = getWorkerShopify(prisma);
  const { admin, session } = await shopify.unauthenticated.admin(shopDomain);

  return {
    admin,
    session,
  };
}
