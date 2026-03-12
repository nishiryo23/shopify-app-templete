import * as webhookDomain from "~/domain/webhooks";

export const action = async () => webhookDomain.enqueueWebhookInboxEvent();
