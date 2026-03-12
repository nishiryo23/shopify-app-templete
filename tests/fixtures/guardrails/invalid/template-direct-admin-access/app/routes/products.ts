export async function action(name) {
  return import(`~/platform/shopify/${name}`);
}
