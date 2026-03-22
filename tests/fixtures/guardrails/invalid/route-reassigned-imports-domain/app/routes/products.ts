let target;
target = "~/domain/billing/entitlement-state.mjs";

export async function action() {
  return import(target);
}
