import test from "node:test";
import assert from "node:assert/strict";

import {
  collectAliasedBindings,
  collectExportedRouteHandlers,
  collectResolvedStringBindings,
  collectVariableAssignments,
  isDeclarationFile,
  isSourceFile,
  isWebhookRouteFile,
  readSimpleReference,
  resolveStaticStringExpression,
  stripTrailingTypeOperators,
} from "../../scripts/check-architecture-guardrails.mjs";

test("guardrail ignores TypeScript declaration files during source scanning", () => {
  assert.equal(isDeclarationFile("app/routes/products.d.ts"), true);
  assert.equal(isDeclarationFile("app/routes/products.d.mts"), true);
  assert.equal(isSourceFile("app/routes/products.d.ts"), false);
  assert.equal(isSourceFile("app/routes/products.ts"), true);
});

test("flat webhook index routes are not treated as webhook endpoints", () => {
  assert.equal(isWebhookRouteFile("app/routes/webhooks._index.tsx"), false);
  assert.equal(isWebhookRouteFile("app/routes/webhooks.products.update.ts"), true);
});

test("nested webhook index routes are not treated as webhook endpoints", () => {
  assert.equal(isWebhookRouteFile("app/routes/webhooks/index.tsx"), false);
  assert.equal(isWebhookRouteFile("app/routes/webhooks/app.uninstalled.ts"), true);
});

test("assigned loader binding remains inspectable when re-exported", () => {
  const handlers = collectExportedRouteHandlers(`
    import { delegatedLoader } from "~/app/lib/delegated-loader";
    export const loader = delegatedLoader;
  `);

  assert.deepEqual(handlers, [
    {
      name: "loader",
      parameters: "",
      body: "return delegatedLoader;",
    },
  ]);
});

test("imported loader and action bindings remain inspectable when re-exported", () => {
  const handlers = collectExportedRouteHandlers(`
    import { delegatedLoader } from "~/app/services/delegated-loader";
    import { delegatedAction } from "~/domain/webhooks/enqueue.server";
    export { delegatedLoader as loader, delegatedAction as action };
  `);

  assert.deepEqual(handlers, [
    {
      name: "loader",
      parameters: "",
      body: "return delegatedLoader;",
    },
    {
      name: "action",
      parameters: "",
      body: "return delegatedAction;",
    },
  ]);
});

test("typed assigned loader and action bindings remain inspectable when re-exported", () => {
  const handlers = collectExportedRouteHandlers(`
    type LoaderFunction = typeof delegatedLoader;
    type ActionFunction = typeof delegatedAction;
    export const loader: LoaderFunction = delegatedLoader as LoaderFunction;
    export const action: ActionFunction = delegatedAction satisfies ActionFunction;
  `);

  assert.deepEqual(handlers, [
    {
      name: "loader",
      parameters: "",
      body: "return delegatedLoader;",
    },
    {
      name: "action",
      parameters: "",
      body: "return delegatedAction;",
    },
  ]);
});

test("inline function type annotations do not hide assigned loader and action bindings", () => {
  const handlers = collectExportedRouteHandlers(`
    type LoaderArgs = { request: Request };
    type ActionArgs = { request: Request };
    export const loader: (args: LoaderArgs) => Promise<Response> = delegatedLoader;
    export const action: (args: ActionArgs) => Promise<Response> = delegatedAction as (
      args: ActionArgs
    ) => Promise<Response>;
  `);

  assert.deepEqual(handlers, [
    {
      name: "loader",
      parameters: "args: LoaderArgs",
      body: "return delegatedLoader;",
    },
    {
      name: "action",
      parameters: "args: ActionArgs",
      body: "return delegatedAction;",
    },
  ]);
});

test("destructured axios methods become callable aliases for direct Admin API detection", () => {
  const assignments = collectVariableAssignments(`
    const axios = { get() { return null; } };
    const { get: request } = axios;
  `);

  assert.deepEqual(assignments, [
    {
      name: "axios",
      expression: "{ get() { return null; } }",
    },
    {
      name: "request",
      expression: "axios.get",
    },
  ]);
});

test("aliased axios object propagates member aliases through destructuring", () => {
  const assignments = collectVariableAssignments(`
    const axios = { get() { return null; } };
    const client = axios;
    const { get: request } = client;
  `);

  assert.deepEqual(
    collectAliasedBindings(assignments, ["axios.get"]),
    ["axios.get", "request"],
  );
});

test("typed destructuring still propagates axios aliases through one level of indirection", () => {
  const assignments = collectVariableAssignments(`
    const axios = { get() { return null; } };
    const client = axios;
    type RequestClient = { get: typeof axios.get };
    const { get: request }: RequestClient = client;
  `);

  assert.deepEqual(
    collectAliasedBindings(assignments, ["axios.get"]),
    ["axios.get", "request"],
  );
});

test("static URL href resolves to the same direct Admin API string", () => {
  const bindings = collectResolvedStringBindings(`
    const shopOrigin = "https://example.myshopify.com";
    const adminPath = "/admin/api/2026-01/graphql.json";
    const url = new URL(adminPath, shopOrigin);
  `);

  assert.equal(
    resolveStaticStringExpression("url.href", bindings),
    "https://example.myshopify.com/admin/api/2026-01/graphql.json",
  );
});

test("static URL toString resolves to the same direct Admin API string", () => {
  const bindings = collectResolvedStringBindings(`
    const shopOrigin = "https://example.myshopify.com";
    const adminPath = "/admin/api/2026-01/graphql.json";
    const url = new URL(adminPath, shopOrigin);
  `);

  assert.equal(
    resolveStaticStringExpression("url.toString()", bindings),
    "https://example.myshopify.com/admin/api/2026-01/graphql.json",
  );
});

test("simple references strip trailing TypeScript operators before resolution", () => {
  assert.equal(
    stripTrailingTypeOperators("delegatedLoader as LoaderFunction"),
    "delegatedLoader",
  );
  assert.equal(
    stripTrailingTypeOperators("delegatedAction satisfies ActionFunction"),
    "delegatedAction",
  );
  assert.equal(
    readSimpleReference("delegatedLoader as LoaderFunction"),
    "delegatedLoader",
  );
  assert.equal(
    stripTrailingTypeOperators("delegatedLoader\tas LoaderFunction"),
    "delegatedLoader",
  );
  assert.equal(
    stripTrailingTypeOperators("delegatedAction\nsatisfies ActionFunction"),
    "delegatedAction",
  );
});

test("tab and newline separated TypeScript operators still preserve handler and axios alias resolution", () => {
  const handlers = collectExportedRouteHandlers(`
    type LoaderFunction = typeof delegatedLoader;
    export const loader: LoaderFunction = delegatedLoader\tas LoaderFunction;
  `);
  const assignments = collectVariableAssignments(`
    const axios = { get() { return null; } };
    const client = axios\tsatisfies { get: typeof axios.get };
    const { get: request }: { get: typeof axios.get } = client;
  `);

  assert.deepEqual(handlers, [
    {
      name: "loader",
      parameters: "",
      body: "return delegatedLoader;",
    },
  ]);
  assert.deepEqual(
    collectAliasedBindings(assignments, ["axios.get"]),
    ["axios.get", "request"],
  );
});
