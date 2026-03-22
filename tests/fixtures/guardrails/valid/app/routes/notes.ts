const migrationNotes = `import "~/domain/billing/entitlement-state.mjs"
Remember: do not use @shopify/admin-api-client in routes.
Reviewer demo note: /admin/api/ appears in docs examples only.`;

export async function loader() {
  return migrationNotes;
}
