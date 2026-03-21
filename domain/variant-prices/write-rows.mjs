import { canonicalizeMoney, moneyValuesEqual, validateMoneyValue } from "./money.mjs";

const VARIANT_PRICE_CHANGED_FIELDS = Object.freeze([
  "price",
  "compare_at_price",
]);

export function getWritableVariantPricePreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.classification === "changed" || row?.classification === "warning")
    : [];
}

export function buildVariantPriceMutationFromPreviewRow(row) {
  const editedRow = row?.editedRow ?? {};
  const targetVariantId = row?.variantId ?? row?.baselineRow?.variant_id ?? editedRow.variant_id;
  const errors = [];

  if (!targetVariantId) {
    return {
      errors: ["variant_id は必須です"],
      ok: false,
    };
  }

  const input = {
    id: targetVariantId,
  };

  if (row.changedFields.includes("price")) {
    const validation = validateMoneyValue(editedRow.price, "price");
    if (!validation.valid) {
      errors.push(validation.error);
    } else if (!validation.normalized) {
      errors.push("price を変更した場合、空欄にはできません");
    } else {
      input.price = validation.canonical;
    }
  }

  if (row.changedFields.includes("compare_at_price")) {
    const validation = validateMoneyValue(editedRow.compare_at_price, "compare_at_price");
    if (!validation.valid) {
      errors.push(validation.error);
    } else if (!validation.normalized) {
      input.compareAtPrice = null;
    } else {
      input.compareAtPrice = validation.canonical;
    }
  }

  return errors.length > 0
    ? { errors, ok: false }
    : { input, ok: true };
}

export function variantPriceChangedFieldsMatch({ actualRow, changedFields, expectedRow }) {
  return (changedFields ?? []).every((field) => {
    if (field === "price" || field === "compare_at_price") {
      return moneyValuesEqual(actualRow?.[field], expectedRow?.[field]);
    }

    return (actualRow?.[field] ?? "") === (expectedRow?.[field] ?? "");
  });
}

export function variantPriceRowsMatch(leftRow, rightRow) {
  return [
    "product_id",
    "product_handle",
    "variant_id",
    "option1_name",
    "option1_value",
    "option2_name",
    "option2_value",
    "option3_name",
    "option3_value",
    "price",
    "compare_at_price",
    "updated_at",
  ].every((field) => {
    if (field === "price" || field === "compare_at_price") {
      return moneyValuesEqual(leftRow?.[field], rightRow?.[field]);
    }

    return (leftRow?.[field] ?? "") === (rightRow?.[field] ?? "");
  });
}

export function buildVariantPriceSummary(rows) {
  const summary = {
    total: rows.length,
    verifiedSuccess: 0,
  };

  for (const row of rows) {
    if (row.verificationStatus === "verified") {
      summary.verifiedSuccess += 1;
    }
  }

  return summary;
}

export function getVariantPriceChangedFields() {
  return VARIANT_PRICE_CHANGED_FIELDS;
}

export function canonicalizePreviewMoney(value) {
  const canonical = canonicalizeMoney(value);
  return canonical ?? value;
}
