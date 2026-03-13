/* eslint-disable no-unused-vars */
export type ScopesApi = {
  query(): Promise<{
    granted: string[];
  }>;
};

export type ShopStateStore = {
  getBootstrapState(_shopDomain: string): Promise<{
    grantedScopes: string[];
    lastBootstrapAt: Date | null;
  } | null>;
  markScopesStale(_shopDomain: string): Promise<void>;
  upsertShopBootstrap(_input: {
    grantedScopes: string[];
    lastBootstrapAt: Date;
    shopDomain: string;
  }): Promise<void>;
};

export async function queryCurrentAppInstallationScopes(scopes: ScopesApi) {
  const scopeDetail = await scopes.query();
  return [...new Set(scopeDetail.granted)].sort();
}

export async function bootstrapShopState({
  scopes,
  shopDomain,
  store,
}: {
  scopes: ScopesApi;
  shopDomain: string;
  store: ShopStateStore;
}) {
  const grantedScopes = await queryCurrentAppInstallationScopes(scopes);

  await store.upsertShopBootstrap({
    grantedScopes,
    lastBootstrapAt: new Date(),
    shopDomain,
  });
}
/* eslint-enable no-unused-vars */
