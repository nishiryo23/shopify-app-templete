import { mapProductNodeToExportRow } from "../../domain/products/export-csv.mjs";

const PRODUCT_PREVIEW_QUERY = `#graphql
  query ProductPreviewNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        status
        vendor
        productType
        tags
        descriptionHtml
        updatedAt
        seo {
          title
          description
        }
      }
    }
  }
`;

async function parseAdminGraphqlResponse(response) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Product preview query failed with HTTP ${response.status}`);
  }

  if (payload.errors?.length) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`Product preview query failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error("Product preview query returned no data");
  }

  return payload.data;
}

export async function readProductsForPreview(
  admin,
  productIds,
  { assertJobLeaseActive = () => {}, chunkSize = 100 } = {},
) {
  const rowsByProductId = new Map();

  for (let index = 0; index < productIds.length; index += chunkSize) {
    assertJobLeaseActive();
    const ids = productIds.slice(index, index + chunkSize);
    const response = await admin.graphql(PRODUCT_PREVIEW_QUERY, {
      variables: { ids },
    });
    const data = await parseAdminGraphqlResponse(response);
    assertJobLeaseActive();

    for (const node of data.nodes ?? []) {
      if (node?.id) {
        rowsByProductId.set(node.id, mapProductNodeToExportRow(node));
      }
    }
  }

  return rowsByProductId;
}
