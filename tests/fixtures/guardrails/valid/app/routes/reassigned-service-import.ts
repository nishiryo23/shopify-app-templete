let target;
target = "~/app/services/health.server";

export async function loader() {
  return import(target);
}
