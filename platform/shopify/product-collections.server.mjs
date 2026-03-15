const PRODUCT_COLLECTION_EXPORT_QUERY = `#graphql
  query ProductCollectionExportPage($after: String) {
    products(first: 50, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
          id
          handle
          updatedAt
          collections(first: 250) {
            nodes {
              id
              handle
              title
              updatedAt
              ruleSet {
                appliedDisjunctively
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
        endCursor
        hasNextPage
      }
    }
  }
`;

const PRODUCT_COLLECTION_PAGE_QUERY = `#graphql
  query ProductCollectionPage($productId: ID!, $after: String) {
    product(id: $productId) {
      id
      handle
      updatedAt
      collections(first: 250, after: $after) {
        nodes {
          id
          handle
          title
          updatedAt
          ruleSet {
            appliedDisjunctively
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

const PRODUCT_COLLECTION_READ_QUERY = `#graphql
  query ProductCollectionRead($productId: ID!) {
    product(id: $productId) {
      id
      handle
      updatedAt
      collections(first: 250) {
        nodes {
          id
          handle
          title
          updatedAt
          ruleSet {
            appliedDisjunctively
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

const COLLECTION_BY_HANDLE_QUERY = `#graphql
  query CollectionByIdentifier($identifier: CollectionIdentifierInput!) {
    collectionByIdentifier(identifier: $identifier) {
      id
      handle
      title
      updatedAt
      ruleSet {
        appliedDisjunctively
      }
    }
  }
`;

const COLLECTION_BY_ID_QUERY = `#graphql
  query CollectionById($id: ID!) {
    node(id: $id) {
      ... on Collection {
        id
        handle
        title
        updatedAt
        ruleSet {
          appliedDisjunctively
        }
      }
    }
  }
`;

const COLLECTION_ADD_PRODUCTS_MUTATION = `#graphql
  mutation CollectionAddProductsV2($id: ID!, $productIds: [ID!]!) {
    collectionAddProductsV2(id: $id, productIds: $productIds) {
      job {
        done
        id
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const COLLECTION_REMOVE_PRODUCTS_MUTATION = `#graphql
  mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job {
        done
        id
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const COLLECTION_JOB_QUERY = `#graphql
  query CollectionJob($id: ID!) {
    node(id: $id) {
      ... on Job {
        done
        id
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

function isManualCollection(collection) {
  return collection?.ruleSet == null;
}

function buildCollectionRow(product, collection) {
  return {
    collection_handle: collection?.handle ?? "",
    collection_id: collection?.id ?? "",
    collection_title: collection?.title ?? "",
    membership: "member",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    updated_at: collection?.updatedAt ?? product?.updatedAt ?? "",
  };
}

async function readAllCollectionsForProduct(admin, product, { assertJobLeaseActive = () => {} } = {}) {
  const allNodes = Array.isArray(product?.collections?.nodes) ? [...product.collections.nodes] : [];
  let pageInfo = product?.collections?.pageInfo;

  while (pageInfo?.hasNextPage) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_COLLECTION_PAGE_QUERY, {
      variables: { after: pageInfo.endCursor, productId: product.id },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductCollectionPage");
    assertJobLeaseActive();

    const nodes = Array.isArray(data.product?.collections?.nodes) ? data.product.collections.nodes : [];
    allNodes.push(...nodes);
    pageInfo = data.product?.collections?.pageInfo;
  }

  return allNodes;
}

export async function* readProductCollectionPagesForExport(
  admin,
  { assertJobLeaseActive = () => {} } = {},
) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_COLLECTION_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductCollectionExportPage");
    assertJobLeaseActive();

    const page = [];
    for (const edge of data.products.edges ?? []) {
      if (!edge?.node) {
        continue;
      }

      const collections = await readAllCollectionsForProduct(admin, edge.node, { assertJobLeaseActive });
      page.push({
        ...edge.node,
        collections: {
          nodes: collections.filter((collection) => isManualCollection(collection)),
        },
      });
    }

    yield page;

    if (!data.products.pageInfo?.hasNextPage) {
      return;
    }

    after = data.products.pageInfo.endCursor;
  }
}

export async function readCollectionsForProducts(admin, productIds, { assertJobLeaseActive = () => {} } = {}) {
  const currentRowsByKey = new Map();
  const existingProductIds = new Set();
  const productRowsById = new Map();

  for (const productId of productIds) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_COLLECTION_READ_QUERY, {
      variables: { productId },
    });
    const data = await parseAdminGraphqlResponse(response, "ProductCollectionRead");
    if (!data.product) {
      continue;
    }

    const product = data.product;
    existingProductIds.add(product.id);
    productRowsById.set(product.id, {
      product_handle: product.handle ?? "",
      product_id: product.id ?? "",
      updated_at: product.updatedAt ?? "",
    });

    const collections = await readAllCollectionsForProduct(admin, product, { assertJobLeaseActive });
    for (const collection of collections) {
      if (!isManualCollection(collection)) {
        continue;
      }

      const row = buildCollectionRow(product, collection);
      currentRowsByKey.set(`${product.id}\u001e${collection.id}`, row);
    }
  }

  return {
    currentRowsByKey,
    existingProductIds,
    productRowsById,
  };
}

export async function resolveCollectionsByHandle(admin, handles, { assertJobLeaseActive = () => {} } = {}) {
  const resolvedCollectionsByHandle = new Map();

  for (const handle of handles) {
    assertJobLeaseActive();
    const response = await admin.graphql(COLLECTION_BY_HANDLE_QUERY, {
      variables: {
        identifier: {
          handle,
        },
      },
    });
    const data = await parseAdminGraphqlResponse(response, "CollectionByIdentifier");
    if (data.collectionByIdentifier) {
      resolvedCollectionsByHandle.set(String(handle).trim().toLowerCase(), data.collectionByIdentifier);
    }
  }

  return resolvedCollectionsByHandle;
}

export async function resolveCollectionsById(admin, ids, { assertJobLeaseActive = () => {} } = {}) {
  const resolvedCollectionsById = new Map();

  for (const id of ids) {
    assertJobLeaseActive();
    const response = await admin.graphql(COLLECTION_BY_ID_QUERY, {
      variables: { id },
    });
    const data = await parseAdminGraphqlResponse(response, "CollectionById");
    if (data.node?.id) {
      resolvedCollectionsById.set(id, data.node);
    }
  }

  return resolvedCollectionsById;
}

export async function addProductsToCollection(admin, { collectionId, productIds }) {
  const response = await admin.graphql(COLLECTION_ADD_PRODUCTS_MUTATION, {
    variables: {
      id: collectionId,
      productIds,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "CollectionAddProductsV2");

  return {
    job: data.collectionAddProductsV2?.job ?? null,
    userErrors: data.collectionAddProductsV2?.userErrors ?? [],
  };
}

export async function removeProductsFromCollection(admin, { collectionId, productIds }) {
  const response = await admin.graphql(COLLECTION_REMOVE_PRODUCTS_MUTATION, {
    variables: {
      id: collectionId,
      productIds,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "CollectionRemoveProducts");

  return {
    job: data.collectionRemoveProducts?.job ?? null,
    userErrors: data.collectionRemoveProducts?.userErrors ?? [],
  };
}

export async function readCollectionJob(admin, { jobId }) {
  const response = await admin.graphql(COLLECTION_JOB_QUERY, {
    variables: { id: jobId },
  });
  const data = await parseAdminGraphqlResponse(response, "CollectionJob");
  return data.node?.id ? data.node : null;
}
