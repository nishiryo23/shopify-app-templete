import { enqueueWebhookInboxEvent } from "~/domain/webhooks/enqueue.server";

export async function action() {
  return enqueueWebhookInboxEvent.name;
}
