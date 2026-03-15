const PRODUCT_METAFIELD_EXPORT_QUERY = `#graphql
  query ProductMetafieldExportPage($after: String) {
    products(first: 50, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
          id
          handle
          metafields(first: 250) {
            nodes {
              key
              namespace
              type
              updatedAt
              value
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const PRODUCT_METAFIELD_PAGE_QUERY = `#graphql
  query ProductMetafieldPage($productId: ID!, $after: String) {
    product(id: $productId) {
      id
      handle
      metafields(first: 250, after: $after) {
        nodes {
          key
          namespace
          type
          updatedAt
          value
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

const PRODUCT_METAFIELD_READ_QUERY = `#graphql
  query ProductMetafieldRead($productId: ID!) {
    product(id: $productId) {
      id
      handle
      metafields(first: 250) {
        nodes {
          key
          namespace
          type
          updatedAt
          value
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation ProductMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        namespace
        type
        value
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

async function parseAdminGraphqlResponse(response, operationName) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`${operationName} failed with HTTP ${response.status}`);
  }

  if (payload.errors?.length) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`${operationName} failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error(`${operationName} returned no data`);
  }

  return payload.data;
}

async function readAllMetafieldsForProduct(admin, product, { assertJobLeaseActive = () => {} } = {}) {
  const allNodes = Array.isArray(product.metafields?.nodes) ? [...product.metafields.nodes] : [];
  let pageInfo = product.metafields?.pageInfo;

  while (pageInfo?.hasNextPage) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_METAFIELD_PAGE_QUERY, {
      variables: { after: pageInfo.endCursor, productId: product.id },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductMetafieldPage");
    assertJobLeaseActive();

    const nodes = Array.isArray(data.product?.metafields?.nodes) ? data.product.metafields.nodes : [];
    allNodes.push(...nodes);
    pageInfo = data.product?.metafields?.pageInfo;
  }

  return allNodes;
}

function buildMetafieldRow(product, metafield) {
  return {
    key: metafield?.key ?? "",
    namespace: metafield?.namespace ?? "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    type: metafield?.type ?? "",
    updated_at: metafield?.updatedAt ?? "",
    value: metafield?.value ?? "",
  };
}

function buildMetafieldRowKey(row) {
  return `${row?.product_id ?? ""}\u001e${row?.namespace ?? ""}\u001e${row?.key ?? ""}`;
}

export async function* readProductMetafieldPagesForExport(
  admin,
  { assertJobLeaseActive = () => {} } = {},
) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_METAFIELD_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductMetafieldExportPage");
    assertJobLeaseActive();

    const page = [];

    for (const edge of data.products.edges) {
      if (!edge.node) {
        continue;
      }

      const metafields = await readAllMetafieldsForProduct(admin, edge.node, { assertJobLeaseActive });
      page.push({
        ...edge.node,
        metafields: { nodes: metafields },
      });
    }

    yield page;

    if (!data.products.pageInfo.hasNextPage) {
      return;
    }

    after = data.products.pageInfo.endCursor;
  }
}

export async function readMetafieldsForProducts(admin, productIds, { assertJobLeaseActive = () => {} } = {}) {
  const existingProductIds = new Set();
  const productRowsById = new Map();
  const rowsByKey = new Map();

  for (const productId of productIds) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_METAFIELD_READ_QUERY, {
      variables: { productId },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductMetafieldRead");
    if (!data.product) {
      continue;
    }

    existingProductIds.add(data.product.id);
    productRowsById.set(data.product.id, {
      product_handle: data.product.handle ?? "",
      product_id: data.product.id ?? "",
      updated_at: "",
    });
    const metafields = await readAllMetafieldsForProduct(admin, data.product, { assertJobLeaseActive });
    for (const metafield of metafields) {
      const row = buildMetafieldRow(data.product, metafield);
      rowsByKey.set(buildMetafieldRowKey(row), row);
    }
  }

  return { existingProductIds, productRowsById, rowsByKey };
}

export async function setProductMetafields(admin, { metafields }) {
  const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "metafieldsSet");

  return {
    metafields: data.metafieldsSet?.metafields ?? [],
    userErrors: data.metafieldsSet?.userErrors ?? [],
  };
}
