/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";

import type { ShopStateStore } from "./shop-state.server";

export function createPrismaShopStateStore(prisma: PrismaClient): ShopStateStore & {
  deleteShop(_shopDomain: string): Promise<void>;
} {
  return {
    async getBootstrapState(shopDomain: string) {
      return prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          grantedScopes: true,
          lastBootstrapAt: true,
        },
      });
    },
    async markScopesStale(shopDomain: string) {
      await prisma.shop.upsert({
        where: { shopDomain },
        update: {
          lastBootstrapAt: null,
        },
        create: {
          shopDomain,
          grantedScopes: [],
          lastBootstrapAt: null,
        },
      });
    },
    async upsertShopBootstrap({ grantedScopes, lastBootstrapAt, shopDomain }) {
      await prisma.shop.upsert({
        where: { shopDomain },
        update: {
          grantedScopes,
          lastBootstrapAt,
        },
        create: {
          shopDomain,
          grantedScopes,
          lastBootstrapAt,
        },
      });
    },
    async deleteShop(shopDomain: string) {
      await prisma.shop.deleteMany({ where: { shopDomain } });
    },
  };
}
/* eslint-enable no-unused-vars */
