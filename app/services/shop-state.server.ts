/* eslint-disable no-unused-vars */
export type ScopesApi = {
  query(): Promise<{
    granted: string[];
  }>;
};

export type AdminGraphqlApi = {
  graphql(_query: string): Promise<Response>;
};

export type ShopStateStore = {
  getBootstrapState(_shopDomain: string): Promise<{
    grantedScopes: string[];
    lastBootstrapAt: Date | null;
    shopGid: string | null;
  } | null>;
  markScopesStale(_shopDomain: string): Promise<void>;
  upsertShopBootstrap(_input: {
    grantedScopes: string[];
    lastBootstrapAt: Date;
    shopGid: string;
    shopDomain: string;
  }): Promise<void>;
};

export const CURRENT_SHOP_GID_QUERY = `#graphql
  query CurrentShopGid {
    shop {
      id
    }
  }
`;

export async function queryCurrentAppInstallationScopes(scopes: ScopesApi) {
  const scopeDetail = await scopes.query();
  return [...new Set(scopeDetail.granted)].sort();
}

export async function queryCurrentShopGid(admin: AdminGraphqlApi) {
  const response = await admin.graphql(CURRENT_SHOP_GID_QUERY);
  const payload = (await response.json()) as {
    data?: {
      shop?: {
        id?: unknown;
      };
    };
  };
  const shopGid = payload.data?.shop?.id;

  if (typeof shopGid !== "string" || !shopGid.startsWith("gid://shopify/Shop/")) {
    throw new Error("Admin API shop { id } did not return a Shopify Shop GID.");
  }

  return shopGid;
}

export async function bootstrapShopState({
  admin,
  scopes,
  shopDomain,
  store,
}: {
  admin: AdminGraphqlApi;
  scopes: ScopesApi;
  shopDomain: string;
  store: ShopStateStore;
}) {
  const [grantedScopes, shopGid] = await Promise.all([
    queryCurrentAppInstallationScopes(scopes),
    queryCurrentShopGid(admin),
  ]);

  await store.upsertShopBootstrap({
    grantedScopes,
    lastBootstrapAt: new Date(),
    shopGid,
    shopDomain,
  });
}
/* eslint-enable no-unused-vars */
