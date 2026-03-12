import { enqueueWebhookInboxEvent } from "~/domain/webhooks";

export async function action() {
  return enqueueWebhookInboxEvent();
}
