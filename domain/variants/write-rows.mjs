const VARIANT_CHANGED_FIELDS = Object.freeze([
  "option1_value",
  "option2_value",
  "option3_value",
  "sku",
  "barcode",
  "taxable",
  "requires_shipping",
  "inventory_policy",
]);

function normalizeBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function normalizeCommand(value) {
  const command = String(value ?? "").trim().toUpperCase();
  if (!command || command === "UPDATE") {
    return "UPDATE";
  }

  return command;
}

export function getWritableVariantPreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.classification === "changed" || row?.classification === "warning")
    : [];
}

export function buildVariantOptionTuple(row) {
  return [row?.option1_value ?? "", row?.option2_value ?? "", row?.option3_value ?? ""].join("\u001f");
}

function buildOptionValues(row) {
  const optionValues = [];

  for (let index = 1; index <= 3; index += 1) {
    const optionName = row[`option${index}_name`];
    const optionValue = row[`option${index}_value`];
    if (!optionName && !optionValue) {
      continue;
    }

    optionValues.push({
      name: optionValue ?? "",
      optionName: optionName ?? "",
    });
  }

  return optionValues;
}

function buildInventoryItem(row, { includeRequiresShipping = false, includeSku = false } = {}) {
  const inventoryItem = {};

  if (includeSku) {
    inventoryItem.sku = row.sku ?? "";
  }

  if (includeRequiresShipping) {
    const requiresShipping = normalizeBoolean(row.requires_shipping);
    if (requiresShipping !== null) {
      inventoryItem.requiresShipping = requiresShipping;
    }
  }

  return Object.keys(inventoryItem).length > 0 ? inventoryItem : undefined;
}

function normalizeBooleanField(value, field) {
  const normalized = normalizeBoolean(value);
  if (normalized === null) {
    return {
      error: `invalid ${field} value: ${value}`,
      value: null,
    };
  }

  return { error: null, value: normalized };
}

export function buildVariantMutationFromPreviewRow(row) {
  const command = normalizeCommand(row?.editedRow?.command);
  const editedRow = row?.editedRow ?? {};
  const errors = [];

  if (command === "CREATE") {
    const variantInput = {
      barcode: editedRow.barcode ?? "",
      inventoryItem: buildInventoryItem(editedRow, {
        includeRequiresShipping: true,
        includeSku: true,
      }),
      optionValues: buildOptionValues(editedRow),
    };
    const taxable = normalizeBooleanField(editedRow.taxable, "taxable");
    if (taxable.error) {
      errors.push(taxable.error);
    } else {
      variantInput.taxable = taxable.value;
    }
    if (editedRow.inventory_policy) {
      variantInput.inventoryPolicy = editedRow.inventory_policy;
    }

    return errors.length > 0
      ? { errors, ok: false }
      : { command, input: variantInput, ok: true };
  }

  if (!editedRow.variant_id) {
    return {
      errors: ["variant_id は必須です"],
      ok: false,
    };
  }

  if (command === "DELETE") {
    return {
      command,
      input: editedRow.variant_id,
      ok: true,
    };
  }

  const variantInput = {
    id: editedRow.variant_id,
  };

  if (row.changedFields.includes("barcode")) {
    variantInput.barcode = editedRow.barcode ?? "";
  }
  if (row.changedFields.includes("inventory_policy")) {
    variantInput.inventoryPolicy = editedRow.inventory_policy ?? "";
  }
  if (row.changedFields.some((field) => field.startsWith("option"))) {
    variantInput.optionValues = buildOptionValues(editedRow);
  }
  if (row.changedFields.includes("sku") || row.changedFields.includes("requires_shipping")) {
    variantInput.inventoryItem = buildInventoryItem(editedRow, {
      includeRequiresShipping: row.changedFields.includes("requires_shipping"),
      includeSku: row.changedFields.includes("sku"),
    });
  }
  if (row.changedFields.includes("taxable")) {
    const taxable = normalizeBooleanField(editedRow.taxable, "taxable");
    if (taxable.error) {
      errors.push(taxable.error);
    } else {
      variantInput.taxable = taxable.value;
    }
  }

  return errors.length > 0
    ? { errors, ok: false }
    : { command, input: variantInput, ok: true };
}

function normalizeComparableValue(field, value) {
  if (field === "taxable" || field === "requires_shipping") {
    return String(normalizeBoolean(value));
  }

  return value ?? "";
}

export function variantRowsMatch(leftRow, rightRow) {
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
    "sku",
    "barcode",
    "taxable",
    "requires_shipping",
    "inventory_policy",
    "updated_at",
  ].every((field) => normalizeComparableValue(field, leftRow?.[field]) === normalizeComparableValue(field, rightRow?.[field]));
}

export function variantChangedFieldsMatch({ actualRow, changedFields, expectedRow }) {
  return (changedFields ?? []).every((field) => (
    normalizeComparableValue(field, actualRow?.[field]) === normalizeComparableValue(field, expectedRow?.[field])
  ));
}

export function buildVariantSummary(rows) {
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

export function getVariantChangedFields() {
  return VARIANT_CHANGED_FIELDS;
}
