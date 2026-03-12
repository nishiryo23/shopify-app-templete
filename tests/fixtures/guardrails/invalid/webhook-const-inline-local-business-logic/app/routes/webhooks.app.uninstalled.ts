export const action = async () => {
  const payload = { topic: "app/uninstalled" };
  return payload.topic.toUpperCase();
};
