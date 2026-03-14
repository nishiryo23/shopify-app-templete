const PRODUCT_VARIANT_EXPORT_QUERY = `#graphql
  query ProductVariantExportPage($after: String) {
    productVariants(first: 100, after: $after, sortKey: ID) {
      edges {
        cursor
        node {
          id
          barcode
          compareAtPrice
          inventoryPolicy
          price
          taxable
          title
          updatedAt
          selectedOptions {
            name
            value
          }
          inventoryItem {
            requiresShipping
            sku
          }
          product {
            id
            handle
            options {
              name
              position
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

const PRODUCT_VARIANT_READ_QUERY = `#graphql
  query ProductVariantPreviewProduct($id: ID!, $after: String) {
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
            barcode
            compareAtPrice
            inventoryPolicy
            price
            taxable
            title
            updatedAt
            selectedOptions {
              name
              value
            }
            inventoryItem {
              requiresShipping
              sku
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

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `#graphql
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `#graphql
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: true) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_DELETE_MUTATION = `#graphql
  mutation ProductVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product {
        id
      }
      userErrors {
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

function mapLiveVariantRow(product, variant) {
  const optionNames = ["", "", ""];
  for (const option of product?.options ?? []) {
    const position = Number(option?.position ?? 0);
    if (position >= 1 && position <= 3) {
      optionNames[position - 1] = option?.name ?? "";
    }
  }

  const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const optionValues = ["", "", ""];
  for (let index = 0; index < selectedOptions.length && index < 3; index += 1) {
    optionValues[index] = selectedOptions[index]?.value ?? "";
  }

  return {
    barcode: variant?.barcode ?? "",
    compare_at_price: variant?.compareAtPrice ?? "",
    command: "",
    inventory_policy: variant?.inventoryPolicy ?? "",
    option1_name: optionNames[0],
    option1_value: optionValues[0],
    option2_name: optionNames[1],
    option2_value: optionValues[1],
    option3_name: optionNames[2],
    option3_value: optionValues[2],
    price: variant?.price ?? "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    requires_shipping: variant?.inventoryItem?.requiresShipping == null
      ? ""
      : String(variant.inventoryItem.requiresShipping),
    sku: variant?.inventoryItem?.sku ?? "",
    taxable: variant?.taxable == null ? "" : String(variant.taxable),
    updated_at: variant?.updatedAt ?? "",
    variant_id: variant?.id ?? "",
  };
}

export async function* readProductVariantPagesForExport(admin, { assertJobLeaseActive = () => {} } = {}) {
  let after = null;

  while (true) {
    assertJobLeaseActive();
    const response = await admin.graphql(PRODUCT_VARIANT_EXPORT_QUERY, {
      variables: { after },
    });
    const data = await parseAdminGraphqlResponse(response, "productVariants export");
    assertJobLeaseActive();

    const page = [];
    for (const edge of data.productVariants.edges ?? []) {
      if (edge?.node) {
        page.push(edge.node);
      }
    }

    yield page;

    if (!data.productVariants.pageInfo?.hasNextPage) {
      return;
    }

    after = data.productVariants.pageInfo.endCursor;
  }
}

export async function readVariantsForProducts(
  admin,
  productIds,
  { assertJobLeaseActive = () => {} } = {},
) {
  const productsById = new Map();
  const variantsByProductId = new Map();

  for (const productId of productIds) {
    let after = null;
    let productLoaded = false;

    while (true) {
      assertJobLeaseActive();
      const response = await admin.graphql(PRODUCT_VARIANT_READ_QUERY, {
        variables: {
          after,
          id: productId,
        },
      });
      const data = await parseAdminGraphqlResponse(response, "product variant preview");
      assertJobLeaseActive();

      const product = data.node;
      if (!product?.id) {
        break;
      }

      if (!productLoaded) {
        productsById.set(product.id, {
          handle: product.handle ?? "",
          id: product.id,
          options: product.options ?? [],
        });
        productLoaded = true;
      }

      const currentVariants = variantsByProductId.get(product.id) ?? [];
      for (const variant of product.variants?.nodes ?? []) {
        currentVariants.push(mapLiveVariantRow(product, variant));
      }
      variantsByProductId.set(product.id, currentVariants);

      if (!product.variants?.pageInfo?.hasNextPage) {
        break;
      }

      after = product.variants.pageInfo.endCursor;
    }
  }

  return {
    productsById,
    variantsByProductId,
  };
}

export async function createVariantsBulk(admin, { productId, variants }) {
  const response = await admin.graphql(PRODUCT_VARIANTS_BULK_CREATE_MUTATION, {
    variables: {
      productId,
      variants,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "productVariantsBulkCreate");
  return {
    productVariants: data.productVariantsBulkCreate?.productVariants ?? [],
    userErrors: data.productVariantsBulkCreate?.userErrors ?? [],
  };
}

export async function updateVariantsBulk(admin, { productId, variants }) {
  const response = await admin.graphql(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
    variables: {
      productId,
      variants,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "productVariantsBulkUpdate");
  return {
    productVariants: data.productVariantsBulkUpdate?.productVariants ?? [],
    userErrors: data.productVariantsBulkUpdate?.userErrors ?? [],
  };
}

export async function deleteVariantBulk(admin, { productId, variantId }) {
  const response = await admin.graphql(PRODUCT_VARIANTS_BULK_DELETE_MUTATION, {
    variables: {
      productId,
      variantsIds: [variantId],
    },
  });
  const data = await parseAdminGraphqlResponse(response, "productVariantsBulkDelete");
  return {
    userErrors: data.productVariantsBulkDelete?.userErrors ?? [],
  };
}
