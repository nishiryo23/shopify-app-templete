import type { ActionFunctionArgs } from "react-router";

import prisma from "../../app/db.server";
import { createPrismaShopStateStore } from "../../app/services/prisma-shop-state-store.server";
import { createPrismaJobQueue } from "../jobs/prisma-job-queue.mjs";
import { enqueueOrFindActiveWebhookShopRedactJob } from "./compliance-jobs.mjs";
import { buildMetadataOnlyWebhookInboxData, isComplianceTopic } from "./compliance.server.mjs";
import { createTelemetry } from "../telemetry/index.mjs";
import { buildWebhookDeliveryKey, processWebhookIngress } from "./inbox-contract.mjs";
import { createPrismaWebhookInboxStore } from "./prisma-inbox-store.mjs";
import {
  deleteRawGrowthStateForShop,
  recordUninstalledFunnelEvent,
} from "../growth/funnel.server";

const shopStateStore = createPrismaShopStateStore(prisma);
const jobQueue = createPrismaJobQueue(prisma);

const telemetry = createTelemetry({
  service: "web",
});

function normalizeTopic(topic: string) {
  return topic.toLowerCase();
}

function isScopesUpdateTopic(topic: string) {
  return topic === "app/scopes_update" || topic === "app/scopes/update";
}

function requireHeader(headers: Headers, name: string) {
  const value = headers.get(name);

  if (!value) {
    throw new Response(null, { status: 400 });
  }

  return value.trim();
}

function resolveErrorCode(error: unknown) {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "unknown-error";
}

function emitWebhookTelemetryEvent(args: Parameters<typeof telemetry.emitEvent>[0]) {
  try {
    telemetry.emitEvent(args);
  } catch (error) {
    console.error("Failed to emit webhook telemetry", {
      errorCode: resolveErrorCode(error),
      event: args.event,
    });
  }
}

async function recordUninstalledFunnelEventBestEffort({ shopDomain }: { shopDomain: string }) {
  try {
    await recordUninstalledFunnelEvent({
      prismaClient: prisma,
      shopDomain,
    });
  } catch (error) {
    emitWebhookTelemetryEvent({
      error: { code: resolveErrorCode(error) },
      event: "growth.uninstalled_snapshot.record_failed",
      level: "warn",
      shopDomain,
    });
  }
}

export async function enqueueWebhookInboxEvent({ request }: ActionFunctionArgs) {
  const rawBody = await request.text();
  const ingressResult = await processWebhookIngress({
    headers: request.headers,
    rawBody,
    clientSecret: process.env.SHOPIFY_API_SECRET || "",
    inbox: createPrismaWebhookInboxStore(prisma),
  });

  if (ingressResult.status !== 200) {
    return new Response(null, { status: ingressResult.status });
  }

  const topic = requireHeader(request.headers, "X-Shopify-Topic");
  const shop = requireHeader(request.headers, "X-Shopify-Shop-Domain");
  const eventId = requireHeader(request.headers, "X-Shopify-Event-Id");
  const webhookId = request.headers.get("X-Shopify-Webhook-Id")?.trim();
  const subscriptionName = request.headers.get("X-Shopify-Name")?.trim();
  const deliveryKey = buildWebhookDeliveryKey({
    shopDomain: shop,
    topic,
    eventId,
    webhookId,
    subscriptionName,
  });
  const normalizedTopic = normalizeTopic(topic);
  const inboxEvent = await prisma.webhookInbox.findUnique({ where: { deliveryKey } });

  if (!inboxEvent) {
    return new Response(null, { status: 500 });
  }

  emitWebhookTelemetryEvent({
    deliveryKey,
    event: "webhook.received",
    jobKind: null,
    shopDomain: shop,
    topic: normalizedTopic,
  });

  if (!ingressResult.enqueued && inboxEvent.processedAt) {
    emitWebhookTelemetryEvent({
      deliveryKey,
      event: "webhook.duplicate",
      shopDomain: shop,
      topic: normalizedTopic,
    });
    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "app/uninstalled") {
    await recordUninstalledFunnelEventBestEffort({ shopDomain: shop });
    await deleteRawGrowthStateForShop({ prismaClient: prisma, shopDomain: shop });
    await prisma.session.deleteMany({ where: { shop } });
    await shopStateStore.deleteShop(shop);
    await prisma.webhookInbox.update({
      where: { deliveryKey },
      data: { processedAt: new Date() },
    });
    emitWebhookTelemetryEvent({
      deliveryKey,
      event: "webhook.processed",
      shopDomain: shop,
      topic: normalizedTopic,
    });

    return new Response(null, { status: 200 });
  }

  if (isScopesUpdateTopic(normalizedTopic)) {
    await shopStateStore.markScopesStale(shop);
    await prisma.webhookInbox.update({
      where: { deliveryKey },
      data: { processedAt: new Date() },
    });
    emitWebhookTelemetryEvent({
      deliveryKey,
      event: "webhook.processed",
      shopDomain: shop,
      topic: normalizedTopic,
    });

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "shop/redact") {
    const job = await enqueueOrFindActiveWebhookShopRedactJob({
      deliveryKey,
      jobQueue,
      prisma,
      shopDomain: shop,
    });

    if (!job) {
      return new Response(null, { status: 500 });
    }

    emitWebhookTelemetryEvent({
      deliveryKey,
      event: "webhook.deferred",
      jobId: job.id,
      jobKind: job.kind,
      shopDomain: shop,
      topic: normalizedTopic,
    });

    return new Response(null, { status: 200 });
  }

  if (isComplianceTopic(normalizedTopic)) {
    await prisma.webhookInbox.update({
      where: { deliveryKey },
      data: buildMetadataOnlyWebhookInboxData({ processedAt: new Date() }),
    });
    emitWebhookTelemetryEvent({
      deliveryKey,
      event: "webhook.processed",
      shopDomain: shop,
      topic: normalizedTopic,
    });

    return new Response(null, { status: 200 });
  }

  await prisma.webhookInbox.update({
    where: { deliveryKey },
    data: { processedAt: new Date() },
  });
  emitWebhookTelemetryEvent({
    deliveryKey,
    event: "webhook.processed",
    shopDomain: shop,
    topic: normalizedTopic,
  });

  return new Response(null, { status: 202 });
}
