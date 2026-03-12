export async function action(kind) {
  return import(`~/domain/${kind}.server`);
}
