const targets = {
  domain: "~/domain/products/write.server",
};

export async function action() {
  return import(targets.domain);
}
