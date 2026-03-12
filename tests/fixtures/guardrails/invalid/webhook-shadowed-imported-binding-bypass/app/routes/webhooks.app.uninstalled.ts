import { enqueueWebhookInboxEvent } from "~/domain/webhooks/enqueue.server";

void enqueueWebhookInboxEvent;

export async function action(enqueueWebhookInboxEvent) {
  return enqueueWebhookInboxEvent();
}
