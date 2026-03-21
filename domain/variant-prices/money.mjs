const MONEY_PATTERN = /^\d+(\.\d+)?$/;

export function normalizeMoneyInput(value) {
  return String(value ?? "").trim();
}

export function canonicalizeMoney(value) {
  const normalized = normalizeMoneyInput(value);
  if (!normalized) {
    return "";
  }

  if (!MONEY_PATTERN.test(normalized)) {
    return null;
  }

  const [integerPartRaw, fractionPartRaw = ""] = normalized.split(".");
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const fractionPart = fractionPartRaw.replace(/0+$/g, "");

  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

export function validateMoneyValue(value, field) {
  const normalized = normalizeMoneyInput(value);
  if (!normalized) {
    return {
      error: null,
      normalized,
      valid: true,
    };
  }

  const canonical = canonicalizeMoney(normalized);
  if (canonical === null) {
    return {
      error: `${field} の値が不正です: ${value}`,
      normalized,
      valid: false,
    };
  }

  return {
    canonical,
    error: null,
    normalized,
    valid: true,
  };
}

export function moneyValuesEqual(left, right) {
  return canonicalizeMoney(left) === canonicalizeMoney(right);
}
