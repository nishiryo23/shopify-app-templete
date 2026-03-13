import { Prisma, type PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage, type PrismaSessionStorageInterface } from "@shopify/shopify-app-session-storage-prisma";

import {
  decryptOfflineSession,
  encryptOfflineSession,
  hasShopTokenEncryptionKey,
} from "./session-crypto.server";

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

type ShopRecord = {
  encryptedOfflineSession: EncryptedPayload;
  offlineSessionId: string | null;
  shopDomain: string;
};

let hasWarnedLegacyOfflineSessionFallback = false;

function isEncryptedPayload(value: unknown): value is {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.ciphertext === "string" &&
    typeof payload.iv === "string" &&
    typeof payload.tag === "string"
  );
}

async function loadOfflineShop(prisma: PrismaClient, id: string) {
  return prisma.shop.findUnique({
    where: { offlineSessionId: id },
    select: {
      encryptedOfflineSession: true,
      offlineSessionId: true,
      shopDomain: true,
    },
  });
}

function requireEncryptedOfflineShop(
  shop: {
    encryptedOfflineSession: unknown;
    offlineSessionId: string | null;
    shopDomain: string;
  } | null,
) {
  if (!shop?.offlineSessionId || !isEncryptedPayload(shop.encryptedOfflineSession)) {
    return null;
  }

  return {
    encryptedOfflineSession: shop.encryptedOfflineSession,
    offlineSessionId: shop.offlineSessionId,
    shopDomain: shop.shopDomain,
  } satisfies ShopRecord;
}

export class ShopSessionStorage implements PrismaSessionStorageInterface {
  private readonly onlineStorage: PrismaSessionStorage<PrismaClient>;
  private readonly encryptedOfflineSessionsEnabled: boolean;

  constructor(private readonly prisma: PrismaClient) {
    this.onlineStorage = new PrismaSessionStorage(prisma);
    this.encryptedOfflineSessionsEnabled = hasShopTokenEncryptionKey();

    if (!this.encryptedOfflineSessionsEnabled && !hasWarnedLegacyOfflineSessionFallback) {
      hasWarnedLegacyOfflineSessionFallback = true;
      console.warn(
        "SHOP_TOKEN_ENCRYPTION_KEY is not configured; falling back to Prisma session storage until encrypted offline session rollout is enabled.",
      );
    }
  }

  private async clearUnreadableOfflineSession(where: { offlineSessionId?: string; shopDomain?: string }) {
    await this.prisma.shop.updateMany({
      where,
      data: {
        encryptedOfflineSession: Prisma.JsonNull,
        offlineSessionId: null,
      },
    });
  }

  private async clearOfflineSessionReference(where: { offlineSessionId?: string | { in: string[] } }) {
    await this.prisma.shop.updateMany({
      where,
      data: {
        encryptedOfflineSession: Prisma.JsonNull,
        offlineSessionId: null,
      },
    });
  }

  async storeSession(session: Session) {
    if (session.isOnline) {
      return this.onlineStorage.storeSession(session);
    }

    if (!this.encryptedOfflineSessionsEnabled) {
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

  async loadSession(id: string) {
    const prismaSession = await this.onlineStorage.loadSession(id);

    if (prismaSession?.isOnline) {
      return prismaSession;
    }

    if (!this.encryptedOfflineSessionsEnabled) {
      return prismaSession ?? undefined;
    }

    const offlineShop = requireEncryptedOfflineShop(await loadOfflineShop(this.prisma, id));

    if (!offlineShop) {
      return prismaSession ?? undefined;
    }

    try {
      return decryptOfflineSession(offlineShop.encryptedOfflineSession);
    } catch (error) {
      console.error("Discarding unreadable encrypted offline session", {
        error,
        offlineSessionId: id,
        shopDomain: offlineShop.shopDomain,
      });
      await this.clearUnreadableOfflineSession({ offlineSessionId: id });
      return prismaSession ?? undefined;
    }
  }

  async deleteSession(id: string) {
    await this.onlineStorage.deleteSession(id);
    await this.clearOfflineSessionReference({ offlineSessionId: id });
    return true;
  }

  async deleteSessions(ids: string[]) {
    await this.onlineStorage.deleteSessions(ids);
    await this.clearOfflineSessionReference({ offlineSessionId: { in: ids } });
    return true;
  }

  async findSessionsByShop(shop: string) {
    const sessions = await this.onlineStorage.findSessionsByShop(shop);

    if (!this.encryptedOfflineSessionsEnabled) {
      return sessions;
    }

    const offlineShop = requireEncryptedOfflineShop(
      await this.prisma.shop.findUnique({
        where: { shopDomain: shop },
        select: {
          encryptedOfflineSession: true,
          offlineSessionId: true,
          shopDomain: true,
        },
      }),
    );

    if (offlineShop) {
      try {
        const decryptedOfflineSession = decryptOfflineSession(offlineShop.encryptedOfflineSession);
        const legacyOfflineSessionIndex = sessions.findIndex(
          (session) => !session.isOnline && session.id === decryptedOfflineSession.id,
        );

        if (legacyOfflineSessionIndex >= 0) {
          sessions.splice(legacyOfflineSessionIndex, 1);
        }

        sessions.push(decryptedOfflineSession);
      } catch (error) {
        console.error("Discarding unreadable encrypted offline session during shop lookup", {
          error,
          offlineSessionId: offlineShop.offlineSessionId,
          shopDomain: shop,
        });
        await this.clearUnreadableOfflineSession({ shopDomain: shop });
      }
    }

    return sessions;
  }

  isReady() {
    return this.onlineStorage.isReady();
  }
}
