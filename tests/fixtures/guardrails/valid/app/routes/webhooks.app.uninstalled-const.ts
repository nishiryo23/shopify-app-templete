import { enqueueWebhookInboxEvent } from "~/domain/webhooks/enqueue.server";

export const action = async () => enqueueWebhookInboxEvent();
