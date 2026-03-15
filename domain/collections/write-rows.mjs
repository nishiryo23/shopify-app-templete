export function getWritableCollectionPreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => Array.isArray(row?.changedFields) && row.changedFields.length > 0)
    : [];
}

export function buildCollectionMembershipSummary(rows) {
  return {
    total: rows.length,
    verifiedSuccess: rows.filter((row) => row.verificationStatus === "verified").length,
  };
}

export function buildCollectionWriteGroups(rows) {
  const groups = new Map();

  for (const row of rows) {
    const collectionId = row?.resolvedCollectionId ?? row?.editedRow?.collection_id ?? "";
    const operation = row?.operation ?? "add";
    if (!collectionId || !row?.productId) {
      continue;
    }

    const key = `${operation}\u001e${collectionId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        collectionId,
        operation,
        productIds: [],
        rows: [],
      };
      groups.set(key, group);
    }

    group.productIds.push(row.productId);
    group.rows.push(row);
  }

  return [...groups.values()];
}

export function chunkCollectionWriteGroups(groups, chunkSize = 250) {
  const chunks = [];

  for (const group of groups) {
    for (let index = 0; index < group.productIds.length; index += chunkSize) {
      const productIds = group.productIds.slice(index, index + chunkSize);
      const rows = group.rows.slice(index, index + chunkSize);
      chunks.push({
        collectionId: group.collectionId,
        operation: group.operation,
        productIds,
        rows,
      });
    }
  }

  return chunks;
}
