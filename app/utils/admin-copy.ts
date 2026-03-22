const ENTITLEMENT_STATE_LABELS = {
  ACTIVE_PAID: "有効",
  PAYMENT_HOLD: "支払い保留",
  PENDING_APPROVAL: "承認待ち",
  UNKNOWN: "未契約",
} as const;

type IncludeCodeOptions = {
  includeCode?: boolean;
};

type EntitlementState = keyof typeof ENTITLEMENT_STATE_LABELS;

function formatCodeLabel(label: string, code: string, includeCode = true) {
  if (!includeCode || !code) {
    return label;
  }

  return `${label} (${code})`;
}

export function getEntitlementStateLabel(
  state: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    ENTITLEMENT_STATE_LABELS[state as EntitlementState] ?? "未契約",
    state,
    includeCode,
  );
}
