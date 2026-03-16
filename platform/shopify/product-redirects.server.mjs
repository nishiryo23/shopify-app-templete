const URL_REDIRECTS_QUERY = `#graphql
  query UrlRedirectsByPath($after: String, $first: Int!, $query: String!) {
    urlRedirects(after: $after, first: $first, query: $query) {
      nodes {
        id
        path
        target
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const URL_REDIRECT_DELETE_MUTATION = `#graphql
  mutation UrlRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
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

export async function readRedirectsByPaths(
  admin,
  paths,
  { assertJobLeaseActive = () => {}, batchSize = 50 } = {},
) {
  const redirectsByPath = new Map();
  const uniquePaths = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];

  for (const path of uniquePaths) {
    redirectsByPath.set(path, []);
  }

  for (let index = 0; index < uniquePaths.length; index += batchSize) {
    const batchPaths = uniquePaths.slice(index, index + batchSize);
    const query = batchPaths.map((path) => `path:${JSON.stringify(path)}`).join(" OR ");
    let after = null;
    let hasNextPage = true;

    while (hasNextPage) {
      assertJobLeaseActive();
      const response = await admin.graphql(URL_REDIRECTS_QUERY, {
        variables: {
          after,
          first: Math.min(250, batchPaths.length),
          query,
        },
      });
      const data = await parseAdminGraphqlResponse(response, "urlRedirects");
      const nodes = data.urlRedirects?.nodes ?? [];
      const pageInfo = data.urlRedirects?.pageInfo ?? {};

      for (const node of nodes) {
        if (!node?.path || !redirectsByPath.has(node.path)) {
          continue;
        }

        redirectsByPath.get(node.path).push({
          id: node.id,
          path: node.path,
          target: node.target,
        });
      }

      after = pageInfo.endCursor ?? null;
      hasNextPage = pageInfo.hasNextPage === true;
    }
  }

  return redirectsByPath;
}

function isRedirectNotFound(userErrors) {
  return (userErrors ?? []).some((entry) => /not found|does not exist|invalid id/i.test(String(entry?.message ?? "")));
}

export async function deleteRedirectById(admin, redirectId) {
  const response = await admin.graphql(URL_REDIRECT_DELETE_MUTATION, {
    variables: {
      id: redirectId,
    },
  });
  const data = await parseAdminGraphqlResponse(response, "urlRedirectDelete");
  const userErrors = data.urlRedirectDelete?.userErrors ?? [];

  return {
    deletedUrlRedirectId: data.urlRedirectDelete?.deletedUrlRedirectId ?? null,
    notFound: isRedirectNotFound(userErrors),
    userErrors,
  };
}
