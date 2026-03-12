const targets = {
  service: "~/app/services/products.server",
};

export async function loader() {
  return import(targets.service);
}
