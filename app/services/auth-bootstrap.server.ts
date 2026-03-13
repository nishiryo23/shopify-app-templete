import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { createPrismaShopStateStore } from "./prisma-shop-state-store.server";
import { bootstrapShopState } from "./shop-state.server";

const shopStateStore = createPrismaShopStateStore(prisma);

async function shouldBootstrapShopState(shopDomain: string) {
  const bootstrapState = await shopStateStore.getBootstrapState(shopDomain);

  if (!bootstrapState) {
    return true;
  }

  if (!bootstrapState.lastBootstrapAt) {
    return true;
  }

  return bootstrapState.grantedScopes.length === 0;
}

async function bootstrapShopStateBestEffort(authContext: Awaited<ReturnType<typeof authenticate.admin>>) {
  if (!(await shouldBootstrapShopState(authContext.session.shop))) {
    return;
  }

  try {
    await bootstrapShopState({
      scopes: authContext.scopes,
      shopDomain: authContext.session.shop,
      store: shopStateStore,
    });
  } catch (error) {
    console.error("Failed to bootstrap shop state after authentication", {
      error,
      shopDomain: authContext.session.shop,
    });
  }
}

export async function authenticateAndBootstrapShop(request: Request) {
  const authContext = await authenticate.admin(request);

  await bootstrapShopStateBestEffort(authContext);

  return authContext;
}
