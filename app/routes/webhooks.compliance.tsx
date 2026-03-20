import type { ActionFunctionArgs } from "react-router";

import { enqueueWebhookInboxEvent } from "~/domain/webhooks/enqueue.server";

export const action = (args: ActionFunctionArgs) => enqueueWebhookInboxEvent(args);
