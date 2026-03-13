export const PRODUCT_EXPORT_QUERY = `#graphql
  query ProductExportPage($after: String) {
    products(first: 100, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function parseAdminGraphqlResponse(response) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Product export query failed with HTTP ${response.status}`);
  }

  if (payload.errors?.length) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`Product export query failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error("Product export query returned no data");
  }

  return payload.data;
}

export async function readProductsForExport(admin) {
  const products = [];
  for await (const page of readProductPagesForExport(admin)) {
    products.push(...page);
  }

  return products;
}

export async function* readProductPagesForExport(
  admin,
  { assertJobLeaseActive = () => {} } = {},
) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response);
    assertJobLeaseActive();

    const page = [];

    for (const edge of data.products.edges) {
      if (edge.node) {
        page.push(edge.node);
      }
    }

    yield page;

    if (!data.products.pageInfo.hasNextPage) {
      return;
    }

    after = data.products.pageInfo.endCursor;
  }
}
