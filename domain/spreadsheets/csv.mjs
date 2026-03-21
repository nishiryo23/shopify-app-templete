function normalizeCsv(csvText) {
  return String(csvText ?? "").replace(/\r\n/g, "\n");
}

export function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

export function parseCsvRows(csvText) {
  const normalizedCsv = normalizeCsv(csvText);
  const rows = [];
  let currentCell = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < normalizedCsv.length; index += 1) {
    const char = normalizedCsv[index];
    const nextChar = normalizedCsv[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error("CSV の解析に失敗しました: 閉じられていない引用符があります");
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

export async function* parseCsvRowsFromStream(readable) {
  let currentCell = "";
  let currentRow = [];
  let inQuotes = false;
  let pendingQuote = false;
  let pendingCarriageReturn = false;

  const pushRow = async () => {
    currentRow.push(currentCell);
    currentCell = "";
    const completedRow = currentRow;
    currentRow = [];
    return completedRow;
  };

  for await (const chunk of readable) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        if (!inQuotes) {
          if (char === "\n") {
            yield await pushRow();
            continue;
          }

          yield await pushRow();
        } else {
          currentCell += "\r";
        }
      }

      if (pendingQuote) {
        pendingQuote = false;
        if (char === "\"") {
          currentCell += "\"";
          continue;
        }

        inQuotes = false;
      }

      if (char === "\"") {
        if (inQuotes) {
          pendingQuote = true;
          continue;
        }

        inQuotes = true;
        continue;
      }

      if (char === "\r") {
        pendingCarriageReturn = true;
        continue;
      }

      if (char === "\n" && !inQuotes) {
        yield await pushRow();
        continue;
      }

      if (char === "," && !inQuotes) {
        currentRow.push(currentCell);
        currentCell = "";
        continue;
      }

      currentCell += char;
    }
  }

  if (pendingQuote) {
    inQuotes = false;
  }

  if (pendingCarriageReturn) {
    if (inQuotes) {
      currentCell += "\r";
    } else {
      yield await pushRow();
    }
  }

  if (inQuotes) {
    throw new Error("CSV の解析に失敗しました: 閉じられていない引用符があります");
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    yield currentRow;
  }
}

export function serializeCsvRows(rows) {
  return rows.map((row) => row.map((value) => csvCell(value)).join(",")).join("\n").concat("\n");
}

export function buildRowObject(headers, cells) {
  const row = {};

  for (let index = 0; index < headers.length; index += 1) {
    row[headers[index]] = cells[index] ?? "";
  }

  return row;
}

export function canonicalizeCsvSpreadsheet({
  csvText,
  headerError,
  headers,
  rowErrorPrefix = "CSV row",
}) {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    throw new Error("CSV にはヘッダー行が必要です");
  }

  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  if (headerRow.length !== headers.length || headerRow.some((value, index) => value !== headers[index])) {
    throw new Error(headerError);
  }

  const canonicalRows = [headers];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== headers.length) {
      throw new Error(`${rowErrorPrefix} ${index + 1} 行目は ${headers.length} 列である必要があります`);
    }

    canonicalRows.push(cells.map((value) => value ?? ""));
  }

  return {
    canonicalCsvText: serializeCsvRows(canonicalRows),
    rowCount: Math.max(canonicalRows.length - 1, 0),
    rows: canonicalRows,
  };
}
