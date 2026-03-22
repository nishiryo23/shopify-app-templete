const targets = {
  domain: "~/domain/billing/entitlement-state.mjs",
};

export async function action() {
  return import(targets.domain);
}
