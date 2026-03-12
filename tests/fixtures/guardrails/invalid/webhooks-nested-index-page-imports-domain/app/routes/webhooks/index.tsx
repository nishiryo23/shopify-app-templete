import { enqueueWebhookInboxEvent } from "~/domain/webhooks";

export function loader() {
  return enqueueWebhookInboxEvent();
}
