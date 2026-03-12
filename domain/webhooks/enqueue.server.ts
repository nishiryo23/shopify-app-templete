import type { ActionFunctionArgs } from "react-router";

import prisma from "../../app/db.server";
import { buildWebhookDeliveryKey, processWebhookIngress } from "./inbox-contract.mjs";
import { createPrismaWebhookInboxStore } from "./prisma-inbox-store.mjs";

function normalizeTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/");
}

function requireHeader(headers: Headers, name: string) {
  const value = headers.get(name);

  if (!value) {
    throw new Response(null, { status: 400 });
  }

  return value.trim();
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
  const inboxEvent = await prisma.webhookInbox.findUnique({ where: { deliveryKey } });

  if (!inboxEvent) {
    return new Response(null, { status: 500 });
  }

  if (!ingressResult.enqueued && inboxEvent.processedAt) {
    return new Response(null, { status: 200 });
  }

  const payload = JSON.parse(rawBody);
  const normalizedTopic = normalizeTopic(topic);

  if (normalizedTopic === "app/uninstalled") {
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.webhookInbox.update({
      where: { deliveryKey },
      data: { processedAt: new Date() },
    });

    return new Response(null, { status: 200 });
  }

  if (normalizedTopic === "app/scopes/update") {
    const currentScopes = Array.isArray(payload.current)
      ? payload.current.join(",")
      : "";

    await prisma.session.updateMany({
      where: { shop },
      data: { scope: currentScopes },
    });
    await prisma.webhookInbox.update({
      where: { deliveryKey },
      data: { processedAt: new Date() },
    });

    return new Response(null, { status: 200 });
  }

  await prisma.webhookInbox.update({
    where: { deliveryKey },
    data: { processedAt: new Date() },
  });

  return new Response(null, { status: 202 });
}
