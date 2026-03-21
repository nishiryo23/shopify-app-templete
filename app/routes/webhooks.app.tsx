import { handleWebhookPrefixProbe } from "~/domain/webhooks/prefix-probe.server";

export const loader = () =>
  handleWebhookPrefixProbe();

export const action = () =>
  handleWebhookPrefixProbe();
