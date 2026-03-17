import ExcelJS from "exceljs";

import { serializeCsvRows, parseCsvRowsFromStream } from "./csv.mjs";

function columnLabelFromIndex(index) {
  let value = index;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function isObjectValue(value) {
  return value != null && typeof value === "object";
}

function isEmptyCellValue(value) {
  if (value == null) {
    return true;
  }

  if (typeof value === "string") {
    return value.length === 0;
  }

  if (isObjectValue(value) && "richText" in value) {
    return Array.isArray(value.richText) && value.richText.length === 0;
  }

  return false;
}

function readWorksheetCellAsStrictText(cell, { header, rowNumber }) {
  const value = cell.value;

  if (isEmptyCellValue(value)) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  const cellReference = `${columnLabelFromIndex(cell.col)}${rowNumber}`;

  if (typeof value === "number") {
    throw new Error(`XLSX cell ${cellReference} for ${header} must be text, not number`);
  }

  if (typeof value === "boolean") {
    throw new Error(`XLSX cell ${cellReference} for ${header} must be text, not boolean`);
  }

  if (value instanceof Date) {
    throw new Error(`XLSX cell ${cellReference} for ${header} must be text, not date`);
  }

  if (isObjectValue(value) && "formula" in value) {
    throw new Error(`XLSX cell ${cellReference} for ${header} must not contain a formula`);
  }

  throw new Error(`XLSX cell ${cellReference} for ${header} must be plain text`);
}

function rowHasExtraColumns(worksheetRow, fromColumnIndex) {
  const lastColumnIndex = worksheetRow.cellCount ?? 0;
  if (lastColumnIndex <= fromColumnIndex) {
    return false;
  }

  for (let index = fromColumnIndex + 1; index <= lastColumnIndex; index += 1) {
    const value = worksheetRow.getCell(index).value;
    if (!isEmptyCellValue(value)) {
      return true;
    }
  }

  return false;
}

export async function canonicalizeXlsxWorksheet({
  body,
  headerError,
  headers,
  worksheetName,
}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body);

  if (workbook.worksheets.length === 0) {
    throw new Error(`XLSX workbook must contain exactly one worksheet named ${worksheetName}`);
  }

  if (workbook.worksheets.length !== 1) {
    throw new Error(`XLSX workbook must contain exactly one worksheet named ${worksheetName}`);
  }

  const worksheet = workbook.worksheets[0];
  if (worksheet.name !== worksheetName) {
    throw new Error(`XLSX worksheet name must exactly match ${worksheetName}`);
  }

  const headerRow = worksheet.getRow(1);
  const headerValues = [];
  for (let index = 0; index < headers.length; index += 1) {
    headerValues.push(readWorksheetCellAsStrictText(headerRow.getCell(index + 1), {
      header: headers[index],
      rowNumber: 1,
    }));
  }

  if (rowHasExtraColumns(headerRow, headers.length)) {
    throw new Error(`XLSX worksheet ${worksheetName} contains unsupported extra columns`);
  }

  if (headerValues.some((value, index) => value !== headers[index])) {
    throw new Error(headerError);
  }

  const rows = [headers];
  const sheetLastRow = worksheet.lastRow?.number ?? 1;
  let lastDataRowNumber = 1;

  for (let rowNumber = 2; rowNumber <= sheetLastRow; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const rowValues = [];
    let hasValue = false;

    for (let index = 0; index < headers.length; index += 1) {
      const value = readWorksheetCellAsStrictText(worksheetRow.getCell(index + 1), {
        header: headers[index],
        rowNumber,
      });
      if (value !== "") {
        hasValue = true;
      }
      rowValues.push(value);
    }

    if (rowHasExtraColumns(worksheetRow, headers.length)) {
      throw new Error(`XLSX row ${rowNumber} contains unsupported extra columns`);
    }

    rows.push(rowValues);
    if (hasValue) {
      lastDataRowNumber = rowNumber;
    }
  }

  while (rows.length > 1 && rows[rows.length - 1].every((value) => value === "")) {
    rows.pop();
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].every((value) => value === "")) {
      throw new Error(`XLSX row ${rowIndex + 1} must not be empty before the end of worksheet`);
    }
  }

  if (rows.length === 1 && lastDataRowNumber > 1) {
    throw new Error("XLSX workbook must not contain only empty data rows");
  }

  return {
    canonicalCsvText: serializeCsvRows(rows),
    rowCount: Math.max(rows.length - 1, 0),
  };
}

export async function readStrictXlsxWorksheetRows({
  body,
  worksheetName,
}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body);

  if (workbook.worksheets.length !== 1) {
    throw new Error(`XLSX workbook must contain exactly one worksheet named ${worksheetName}`);
  }

  const worksheet = workbook.worksheets[0];
  if (worksheet.name !== worksheetName) {
    throw new Error(`XLSX worksheet name must exactly match ${worksheetName}`);
  }

  const headerRow = worksheet.getRow(1);
  const headerWidth = headerRow.cellCount ?? 0;
  const headerValues = [];
  for (let index = 0; index < headerWidth; index += 1) {
    headerValues.push(readWorksheetCellAsStrictText(headerRow.getCell(index + 1), {
      header: `column ${index + 1}`,
      rowNumber: 1,
    }));
  }

  if (headerValues.length === 0 || headerValues.every((value) => value === "")) {
    throw new Error("XLSX workbook must include a header row");
  }

  while (headerValues.length > 0 && headerValues[headerValues.length - 1] === "") {
    headerValues.pop();
  }

  const rows = [headerValues];
  const sheetLastRow = worksheet.lastRow?.number ?? 1;
  let lastDataRowNumber = 1;

  for (let rowNumber = 2; rowNumber <= sheetLastRow; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const rowWidth = Math.max(worksheetRow.cellCount ?? 0, headerValues.length);
    const rowValues = [];
    let hasValue = false;

    for (let index = 0; index < rowWidth; index += 1) {
      const value = readWorksheetCellAsStrictText(worksheetRow.getCell(index + 1), {
        header: headerValues[index] || `column ${index + 1}`,
        rowNumber,
      });
      if (value !== "") {
        hasValue = true;
      }
      rowValues.push(value);
    }

    rows.push(rowValues);
    if (hasValue) {
      lastDataRowNumber = rowNumber;
    }
  }

  while (rows.length > 1 && rows[rows.length - 1].every((value) => value === "")) {
    rows.pop();
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex].every((value) => value === "")) {
      throw new Error(`XLSX row ${rowIndex + 1} must not be empty before the end of worksheet`);
    }
  }

  if (rows.length === 1 && lastDataRowNumber > 1) {
    throw new Error("XLSX workbook must not contain only empty data rows");
  }

  return rows.map((row) => {
    const normalized = [...row];
    while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
      normalized.pop();
    }
    return normalized;
  });
}

export async function buildXlsxBufferFromRows({
  rows,
  worksheetName,
}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);

  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      const cell = worksheet.getCell(rowIndex + 1, columnIndex + 1);
      cell.value = value == null ? "" : String(value);
      cell.numFmt = "@";
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildXlsxFileFromCsvStream({
  csvStream,
  filePath,
  worksheetName,
}) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useSharedStrings: false,
    useStyles: true,
  });
  const worksheet = workbook.addWorksheet(worksheetName);

  for await (const row of parseCsvRowsFromStream(csvStream)) {
    const worksheetRow = worksheet.addRow(row.map((value) => value == null ? "" : String(value)));
    worksheetRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = "@";
    });
    worksheetRow.commit();
  }

  await workbook.commit();
}
