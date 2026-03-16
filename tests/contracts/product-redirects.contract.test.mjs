import test from "node:test";
import assert from "node:assert/strict";

import { readRedirectsByPaths } from "../../platform/shopify/product-redirects.server.mjs";

function buildGraphqlResponse(data) {
  return {
    ok: true,
    async json() {
      return { data };
    },
  };
}

test("readRedirectsByPaths batches multiple paths into a single search query", async () => {
  const graphqlCalls = [];

  const redirectsByPath = await readRedirectsByPaths(
    {
      async graphql(_query, { variables }) {
        graphqlCalls.push(variables);
        return buildGraphqlResponse({
          urlRedirects: {
            nodes: [
              {
                id: "gid://shopify/UrlRedirect/1",
                path: "/products/hat-old",
                target: "/products/hat-new",
              },
              {
                id: "gid://shopify/UrlRedirect/2",
                path: "/products/coat-old",
                target: "/products/coat-new",
              },
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        });
      },
    },
    ["/products/hat-old", "/products/coat-old", "/products/missing"],
    { batchSize: 10 },
  );

  assert.equal(graphqlCalls.length, 1);
  assert.match(graphqlCalls[0].query, /path:"\/products\/hat-old"/);
  assert.match(graphqlCalls[0].query, /OR path:"\/products\/coat-old"/);
  assert.match(graphqlCalls[0].query, /OR path:"\/products\/missing"/);
  assert.equal(graphqlCalls[0].first, 3);
  assert.deepEqual(redirectsByPath.get("/products/hat-old"), [{
    id: "gid://shopify/UrlRedirect/1",
    path: "/products/hat-old",
    target: "/products/hat-new",
  }]);
  assert.deepEqual(redirectsByPath.get("/products/coat-old"), [{
    id: "gid://shopify/UrlRedirect/2",
    path: "/products/coat-old",
    target: "/products/coat-new",
  }]);
  assert.deepEqual(redirectsByPath.get("/products/missing"), []);
});

test("readRedirectsByPaths chunks and paginates batched redirect searches", async () => {
  const graphqlCalls = [];

  const redirectsByPath = await readRedirectsByPaths(
    {
      async graphql(_query, { variables }) {
        graphqlCalls.push(variables);

        if (graphqlCalls.length === 1) {
          return buildGraphqlResponse({
            urlRedirects: {
              nodes: [{
                id: "gid://shopify/UrlRedirect/1",
                path: "/products/hat-old",
                target: "/products/hat-new",
              }],
              pageInfo: {
                endCursor: "cursor-1",
                hasNextPage: true,
              },
            },
          });
        }

        if (graphqlCalls.length === 2) {
          return buildGraphqlResponse({
            urlRedirects: {
              nodes: [{
                id: "gid://shopify/UrlRedirect/2",
                path: "/products/coat-old",
                target: "/products/coat-new",
              }],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          });
        }

        return buildGraphqlResponse({
          urlRedirects: {
            nodes: [{
              id: "gid://shopify/UrlRedirect/3",
              path: "/products/bag-old",
              target: "/products/bag-new",
            }],
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        });
      },
    },
    ["/products/hat-old", "/products/coat-old", "/products/bag-old"],
    { batchSize: 2 },
  );

  assert.equal(graphqlCalls.length, 3);
  assert.equal(graphqlCalls[0].after, null);
  assert.equal(graphqlCalls[1].after, "cursor-1");
  assert.equal(graphqlCalls[2].after, null);
  assert.equal(graphqlCalls[0].first, 2);
  assert.equal(graphqlCalls[2].first, 1);
  assert.match(graphqlCalls[2].query, /path:"\/products\/bag-old"/);
  assert.deepEqual(redirectsByPath.get("/products/hat-old"), [{
    id: "gid://shopify/UrlRedirect/1",
    path: "/products/hat-old",
    target: "/products/hat-new",
  }]);
  assert.deepEqual(redirectsByPath.get("/products/coat-old"), [{
    id: "gid://shopify/UrlRedirect/2",
    path: "/products/coat-old",
    target: "/products/coat-new",
  }]);
  assert.deepEqual(redirectsByPath.get("/products/bag-old"), [{
    id: "gid://shopify/UrlRedirect/3",
    path: "/products/bag-old",
    target: "/products/bag-new",
  }]);
});
