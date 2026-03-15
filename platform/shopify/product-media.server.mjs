const PRODUCT_MEDIA_EXPORT_QUERY = `#graphql
  query ProductMediaExportPage($after: String) {
    products(first: 50, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
          id
          handle
          updatedAt
          media(first: 250) {
            nodes {
              id
              alt
              mediaContentType
              updatedAt
              preview {
                image {
                  url
                }
              }
              ... on MediaImage {
                image {
                  url
                }
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
`;

const PRODUCT_MEDIA_PAGE_QUERY = `#graphql
  query ProductMediaPage($productId: ID!, $after: String) {
    product(id: $productId) {
      id
      handle
      updatedAt
      media(first: 250, after: $after) {
        nodes {
          id
          alt
          mediaContentType
          updatedAt
          preview {
            image {
              url
            }
          }
          ... on MediaImage {
            image {
              url
            }
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

const PRODUCT_MEDIA_READ_QUERY = `#graphql
  query ProductMediaRead($productId: ID!) {
    product(id: $productId) {
      id
      handle
      updatedAt
      media(first: 250) {
        nodes {
          id
          alt
          mediaContentType
          updatedAt
          preview {
            image {
              url
            }
          }
          ... on MediaImage {
            image {
              url
            }
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

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
        mediaContentType
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_MEDIA_MUTATION = `#graphql
  mutation ProductUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `#graphql
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_REORDER_MEDIA_MUTATION = `#graphql
  mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job {
        done
        id
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_MEDIA_JOB_QUERY = `#graphql
  query ProductMediaJob($id: ID!) {
    node(id: $id) {
      ... on Job {
        done
        id
      }
    }
  }
`;

async function parseAdminGraphqlResponse(response) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Product media query failed with HTTP ${response.status}`);
  }

  if (payload.errors?.length) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`Product media query failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error("Product media query returned no data");
  }

  return payload.data;
}

async function readAllMediaForProduct(admin, product, { assertJobLeaseActive = () => {} } = {}) {
  const allNodes = Array.isArray(product.media?.nodes) ? [...product.media.nodes] : [];
  let pageInfo = product.media?.pageInfo;

  while (pageInfo?.hasNextPage) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_MEDIA_PAGE_QUERY, {
      variables: { after: pageInfo.endCursor, productId: product.id },
    });
    const data = await parseAdminGraphqlResponse(response);
    assertJobLeaseActive();

    const nodes = Array.isArray(data.product?.media?.nodes) ? data.product.media.nodes : [];
    allNodes.push(...nodes);
    pageInfo = data.product?.media?.pageInfo;
  }

  return allNodes;
}

export async function* readProductMediaPagesForExport(
  admin,
  { assertJobLeaseActive = () => {} } = {},
) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_MEDIA_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response);
    assertJobLeaseActive();

    const page = [];

    for (const edge of data.products.edges) {
      if (edge.node) {
        const allMedia = await readAllMediaForProduct(admin, edge.node, { assertJobLeaseActive });
        page.push({
          ...edge.node,
          media: { nodes: allMedia },
        });
      }
    }

    yield page;

    if (!data.products.pageInfo.hasNextPage) {
      return;
    }

    after = data.products.pageInfo.endCursor;
  }
}

function buildMediaRowFromNode(product, media, position) {
  return {
    image_alt: media?.alt ?? "",
    image_position: String(position),
    image_src: media?.image?.url ?? media?.preview?.image?.url ?? "",
    media_content_type: media?.mediaContentType ?? "",
    media_id: media?.id ?? "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    updated_at: media?.updatedAt ?? product?.updatedAt ?? "",
  };
}

function buildMediaStateFromNode(product, media, position) {
  return {
    image_alt: media?.alt ?? "",
    image_position: String(position),
    image_src: media?.image?.url ?? media?.preview?.image?.url ?? "",
    media_content_type: media?.mediaContentType ?? "",
    media_id: media?.id ?? "",
    product_id: product?.id ?? "",
  };
}

export async function readMediaForProducts(admin, productIds, { assertJobLeaseActive = () => {} } = {}) {
  const rowsByKey = new Map();
  const mediaSetByProduct = new Map();

  for (const productId of productIds) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_MEDIA_READ_QUERY, {
      variables: { productId },
    });
    const data = await parseAdminGraphqlResponse(response);

    if (!data.product) {
      continue;
    }

    const product = data.product;
    const allMedia = await readAllMediaForProduct(admin, product, { assertJobLeaseActive });
    mediaSetByProduct.set(
      product.id,
      allMedia.map((media, index) => buildMediaStateFromNode(product, media, index + 1)),
    );

    for (const [index, media] of allMedia.entries()) {
      if (media?.mediaContentType !== "IMAGE") {
        continue;
      }

      const row = buildMediaRowFromNode(product, media, index + 1);
      const key = `${product.id}\u001e${media.id}`;
      rowsByKey.set(key, row);
    }
  }

  return { mediaSetByProduct, rowsByKey };
}

export async function createProductMedia(admin, { media, productId }) {
  const response = await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
    variables: {
      media,
      productId,
    },
  });
  const data = await parseAdminGraphqlResponse(response);

  return {
    media: data.productCreateMedia?.media ?? [],
    userErrors: data.productCreateMedia?.mediaUserErrors ?? [],
  };
}

export async function updateProductMedia(admin, { media, productId }) {
  const response = await admin.graphql(PRODUCT_UPDATE_MEDIA_MUTATION, {
    variables: {
      media,
      productId,
    },
  });
  const data = await parseAdminGraphqlResponse(response);

  return {
    media: data.productUpdateMedia?.media ?? [],
    userErrors: data.productUpdateMedia?.mediaUserErrors ?? [],
  };
}

export async function deleteProductMedia(admin, { mediaIds, productId }) {
  const response = await admin.graphql(PRODUCT_DELETE_MEDIA_MUTATION, {
    variables: {
      mediaIds,
      productId,
    },
  });
  const data = await parseAdminGraphqlResponse(response);

  return {
    deletedMediaIds: data.productDeleteMedia?.deletedMediaIds ?? [],
    userErrors: data.productDeleteMedia?.mediaUserErrors ?? [],
  };
}

export async function reorderProductMedia(admin, { moves, productId }) {
  const response = await admin.graphql(PRODUCT_REORDER_MEDIA_MUTATION, {
    variables: {
      id: productId,
      moves,
    },
  });
  const data = await parseAdminGraphqlResponse(response);

  return {
    job: data.productReorderMedia?.job ?? null,
    userErrors: data.productReorderMedia?.mediaUserErrors ?? [],
  };
}

export async function readProductMediaJob(admin, { jobId }) {
  const response = await admin.graphql(PRODUCT_MEDIA_JOB_QUERY, {
    variables: { id: jobId },
  });
  const data = await parseAdminGraphqlResponse(response);

  return data.node?.id ? data.node : null;
}
