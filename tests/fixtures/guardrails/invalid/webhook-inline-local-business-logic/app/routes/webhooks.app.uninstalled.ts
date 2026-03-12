export async function action() {
  const payload = { topic: "app/uninstalled" };
  return payload.topic.toUpperCase();
}
