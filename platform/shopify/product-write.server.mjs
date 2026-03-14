const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductCoreUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
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

export async function updateProductCoreFields(admin, productInput) {
  const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
    variables: {
      product: productInput,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "productUpdate");
  return {
    productId: data.productUpdate?.product?.id ?? null,
    userErrors: data.productUpdate?.userErrors ?? [],
  };
}

