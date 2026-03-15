const PRODUCT_INVENTORY_EXPORT_QUERY = `#graphql
  query ProductInventoryExportPage($after: String) {
    productVariants(first: 100, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
          id
          updatedAt
          selectedOptions {
            name
            value
          }
          product {
            id
            handle
            options {
              name
              position
            }
          }
          inventoryItem {
            id
            inventoryLevels(first: 250) {
              nodes {
                updatedAt
                location {
                  id
                  name
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
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

const PRODUCT_INVENTORY_READ_QUERY = `#graphql
  query ProductInventoryPreviewProduct($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        id
        handle
        options {
          name
          position
        }
        variants(first: 250, after: $after, sortKey: POSITION) {
          nodes {
            id
            updatedAt
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
              inventoryLevels(first: 250) {
                nodes {
                  updatedAt
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
                pageInfo {
                  endCursor
                  hasNextPage
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const INVENTORY_ITEM_LEVELS_QUERY = `#graphql
  query InventoryItemLevelsPage($id: ID!, $after: String) {
    node(id: $id) {
      ... on InventoryItem {
        id
        inventoryLevels(first: 250, after: $after) {
          nodes {
            updatedAt
            location {
              id
              name
            }
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
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

function resolveAvailableQuantity(level) {
  const quantities = Array.isArray(level?.quantities) ? level.quantities : [];
  const available = quantities.find((quantity) => quantity?.name === "available");
  return available?.quantity == null ? "" : String(available.quantity);
}

function normalizeOptionNames(product) {
  const options = Array.isArray(product?.options) ? product.options : [];
  const names = ["", "", ""];

  for (const option of options) {
    const position = Number(option?.position ?? 0);
    if (position >= 1 && position <= 3) {
      names[position - 1] = option?.name ?? "";
    }
  }

  return names;
}

function normalizeOptionValues(variant) {
  const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const values = ["", "", ""];

  for (let index = 0; index < selectedOptions.length && index < 3; index += 1) {
    values[index] = selectedOptions[index]?.value ?? "";
  }

  return values;
}

async function readAllInventoryLevelsForInventoryItem(
  admin,
  inventoryItem,
  { assertJobLeaseActive = () => {} } = {},
) {
  const inventoryItemId = inventoryItem?.id ?? null;
  const initialConnection = inventoryItem?.inventoryLevels ?? null;
  const levels = Array.isArray(initialConnection?.nodes) ? [...initialConnection.nodes] : [];
  let after = initialConnection?.pageInfo?.endCursor ?? null;
  let hasNextPage = initialConnection?.pageInfo?.hasNextPage === true;

  while (inventoryItemId && hasNextPage) {
    assertJobLeaseActive();
    const response = await admin.graphql(INVENTORY_ITEM_LEVELS_QUERY, {
      variables: {
        after,
        id: inventoryItemId,
      },
    });
    const data = await parseAdminGraphqlResponse(response, "inventory item levels");
    assertJobLeaseActive();

    const node = data.node;
    if (!node?.id) {
      throw new Error("inventory item levels returned no inventory item");
    }

    const connection = node.inventoryLevels;
    if (Array.isArray(connection?.nodes)) {
      levels.push(...connection.nodes);
    }

    after = connection?.pageInfo?.endCursor ?? null;
    hasNextPage = connection?.pageInfo?.hasNextPage === true;
  }

  return levels;
}

async function mapInventoryRows(
  admin,
  product,
  variant,
  { assertJobLeaseActive = () => {} } = {},
) {
  const [option1Name, option2Name, option3Name] = normalizeOptionNames(product);
  const [option1Value, option2Value, option3Value] = normalizeOptionValues(variant);
  const levels = await readAllInventoryLevelsForInventoryItem(admin, variant?.inventoryItem, {
    assertJobLeaseActive,
  });

  return levels.map((level) => ({
    available: resolveAvailableQuantity(level),
    inventory_item_id: variant?.inventoryItem?.id ?? "",
    location_id: level?.location?.id ?? "",
    location_name: level?.location?.name ?? "",
    option1_name: option1Name,
    option1_value: option1Value,
    option2_name: option2Name,
    option2_value: option2Value,
    option3_name: option3Name,
    option3_value: option3Value,
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    updated_at: level?.updatedAt ?? variant?.updatedAt ?? "",
    variant_id: variant?.id ?? "",
  }));
}

async function hydrateVariantInventoryLevels(
  admin,
  variant,
  { assertJobLeaseActive = () => {} } = {},
) {
  const levels = await readAllInventoryLevelsForInventoryItem(admin, variant?.inventoryItem, {
    assertJobLeaseActive,
  });

  return {
    ...variant,
    inventoryItem: {
      ...(variant?.inventoryItem ?? {}),
      inventoryLevels: {
        nodes: levels,
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      },
    },
  };
}

function buildRowKey(row) {
  return `${row?.variant_id ?? ""}\u001e${row?.location_id ?? ""}`;
}

export async function* readProductInventoryPagesForExport(
  admin,
  { assertJobLeaseActive = () => {} } = {},
) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_INVENTORY_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response, "product inventory export");
    assertJobLeaseActive();

    const page = [];
    for (const edge of data.productVariants?.edges ?? []) {
      if (edge?.node) {
        page.push(await hydrateVariantInventoryLevels(admin, edge.node, { assertJobLeaseActive }));
      }
    }

    yield page;

    if (!data.productVariants?.pageInfo?.hasNextPage) {
      return;
    }

    after = data.productVariants.pageInfo.endCursor;
  }
}

export async function readInventoryLevelsForProducts(
  admin,
  productIds,
  { assertJobLeaseActive = () => {} } = {},
) {
  const rowsByKey = new Map();

  for (const productId of productIds) {
    let after = null;

    while (true) {
      assertJobLeaseActive();
      const response = await admin.graphql(PRODUCT_INVENTORY_READ_QUERY, {
        variables: {
          after,
          id: productId,
        },
      });
      const data = await parseAdminGraphqlResponse(response, "product inventory preview");
      assertJobLeaseActive();

      const product = data.node;
      if (!product?.id) {
        break;
      }

      for (const variant of product.variants?.nodes ?? []) {
        const rows = await mapInventoryRows(admin, product, variant, { assertJobLeaseActive });
        for (const row of rows) {
          rowsByKey.set(buildRowKey(row), row);
        }
      }

      if (!product.variants?.pageInfo?.hasNextPage) {
        break;
      }

      after = product.variants.pageInfo.endCursor;
    }
  }

  return {
    rowsByKey,
  };
}

const INVENTORY_SET_QUANTITIES_MUTATION = `#graphql
  mutation InventorySetQuantities(
    $idempotencyKey: String!
    $input: InventorySetQuantitiesInput!
  ) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        reason
        referenceDocumentUri
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function setInventoryQuantities(
  admin,
  {
    idempotencyKey,
    quantities,
    reason = "correction",
    referenceDocumentUri,
  },
) {
  const response = await admin.graphql(INVENTORY_SET_QUANTITIES_MUTATION, {
    variables: {
      idempotencyKey,
      input: {
        name: "available",
        quantities,
        reason,
        referenceDocumentUri,
      },
    },
  });
  const data = await parseAdminGraphqlResponse(response, "inventorySetQuantities");
  return data.inventorySetQuantities;
}
