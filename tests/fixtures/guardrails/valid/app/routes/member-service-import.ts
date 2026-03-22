const targets = {
  service: "~/app/services/health.server",
};

export async function loader() {
  return import(targets.service);
}
