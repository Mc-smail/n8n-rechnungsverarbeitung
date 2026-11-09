import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {columns, emptyLedger} from './engine.mjs';
import {demoObject} from '../fixtures.mjs';

// The display order can differ from the keys used by the engine.
const preferred = {
  Rechnungen: [
    'Rechnungsnummer', 'Datum', 'Kreditor_Name', 'Belegart', 'Netto', 'USt',
    'Brutto', 'Währung', 'Zahlbetrag', 'Fälligkeit', 'Status', 'Pruefung_ok',
    'Abschlaege_brutto', 'ObjektID', 'KreditorID', 'RechnungID',
    'Leistungszeitraum', 'Skonto_Prozent', 'Lohnanteil_35a',
    'Bezug_Rechnungsnummer', 'Rechendifferenz', 'Faelligkeit_Herleitung',
    'Netto_Herleitung', 'Dateiname', 'Mail_Absender',
  ],
  Rechnungspositionen: ['Rechnungsnummer', 'Pos_Nr', 'Beschreibung', 'Menge',
    'Einheit', 'Einzelpreis', 'Gesamt netto', 'USt-Satz', 'Kategorie', 'USt_Status', 'Währung'],
  Kreditoren: ['Name', 'Adresse', 'USt-ID', 'Steuernummer', 'IBAN', 'Status',
    'KreditorID', 'Strasse', 'PLZ', 'Ort', 'Angelegt am'],
  Einheiten: ['EinheitID', 'ObjektID', 'Bezeichnung', 'Lage', 'Nutzungsart',
    'Wohnfläche', 'MEA', 'Zimmer'],
  Audit_Log: ['Dateiname', 'Ergebnis', 'Manuell prüfen', 'Prüfhinweis', 'Probleme',
    'Zeitpunkt', 'Herkunft', 'Dauer_s', 'Rechnungsnummer', 'Kreditor',
    'Belegart', 'Datum', 'Netto', 'USt', 'Brutto', 'Währung', 'Abschlaege_brutto',
    'Zahlbetrag', 'Herleitungen', 'Verbrauchsstelle', 'Auslesemodus'],
};
const sheetNames = ['Rechnungen', 'Rechnungspositionen', 'Kreditoren',
  'Objekte', 'Einheiten', 'Audit_Log'];
const money = new Set(['Netto', 'USt', 'Brutto', 'Zahlbetrag',
  'Abschlaege_brutto', 'Einzelpreis', 'Gesamt netto', 'Rechendifferenz',
  'Lohnanteil_35a']);
const dates = new Set(['Datum', 'Fälligkeit']);
const timestamps = new Set(['Zeitpunkt', 'Angelegt am', 'Mail-Datum']);
const numeric = new Set(['Menge', 'Wohnfläche', 'MEA', 'Zimmer', 'Pos_Nr',
  'Dauer_s', 'USt-Satz', 'Skonto_Prozent', 'Input-Token', 'Output-Token']);
const identifiers = new Set(['Rechnungsnummer', 'Bezug_Rechnungsnummer',
  'USt-ID', 'IBAN', 'PLZ', 'Hausnummer', 'Steuernummer', 'Mail-ID']);
const wrap = new Set(['Name', 'Kreditor_Name', 'Adresse', 'Beschreibung',
  'Dateiname', 'Prüfhinweis', 'Probleme', 'Verbrauchsstelle',
  'Fehlende Pflichtfelder', 'Faelligkeit_Herleitung', 'Netto_Herleitung',
  'Herleitungen', 'Betreff', 'Antwortdatei']);
const widths = {
  Dateiname: 55, 'Prüfhinweis': 56, Probleme: 65, Verbrauchsstelle: 48,
  Beschreibung: 42, Adresse: 42, Name: 36, Kreditor_Name: 36,
  IBAN: 29, PLZ: 12, 'Angelegt am': 25, Zeitpunkt: 25, 'Mail-Datum': 25,
  Datum: 15, 'Fälligkeit': 15, USt: 14, Netto: 15, Brutto: 15,
  Zahlbetrag: 16, Rechnungsnummer: 24, Ergebnis: 22, Dauer_s: 13,
  PDF_SHA256: 66, Antwortdatei: 43,
};
const rowStatus = {
  'Klärung': 'FFFFF1D6',
  'zu prüfen': 'FFFFF1D6',
  'Objekt unbekannt': 'FFFFF1D6',
  Fehler: 'FFFCE7E7',
  Dublette: 'FFE0EAF4',
};
const outcomeLabel = {geschrieben: 'Geschrieben', 'kein Beleg': 'Kein Beleg'};
const outcomeKey = {Geschrieben: 'geschrieben', 'Kein Beleg': 'kein Beleg'};

function columnWidth(header) {
  return widths[header] ?? Math.max(15, header.length + 5);
}

function numberFormat(header) {
  if (money.has(header)) return '#,##0.00;[Red]-#,##0.00';
  if (dates.has(header)) return 'dd.mm.yyyy';
  if (timestamps.has(header)) return 'dd.mm.yyyy hh:mm:ss';
  if (header === 'USt-Satz') return '0.0%';
  if (header === 'Skonto_Prozent') return '0.0" %"';
  if (['Menge', 'Wohnfläche', 'Dauer_s'].includes(header)) return '0.00';
  if (numeric.has(header)) return '0';
  return '@';
}

function tableData(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  const table = sheet?.getTable(name);
  if (!table) throw Error(`Excel-Tabelle ${name} fehlt.`);
  const {columns: definitions, tableRef, totalsRow} = table.model;
  const bounds = /^A1:[A-Z]+(\d+)$/.exec(tableRef);
  if (!bounds || totalsRow) throw Error(`Tabelle ${name} muss bei A1 beginnen und ohne Ergebniszeile geführt werden.`);
  const headers = definitions.map(column => column.name);
  for (const header of columns[name]) {
    if (!headers.includes(header)) throw Error(`In ${name} fehlt die Spalte ${header}.`);
  }
  const end = Number(bounds[1]);
  const rows = Array.from({length: end - 1}, (_, offset) =>
    headers.map((_, index) => sheet.getCell(offset + 2, index + 1).value));
  return {sheet, table, headers, rows, end};
}

function displayValue(header, value) {
  if (value === '' || value == null) return null;
  if (dates.has(header) || timestamps.has(header)) {
    const date = new Date(value);
    if (Number.isFinite(date.valueOf())) return date;
  }
  if (typeof value === 'number' && !identifiers.has(header)) return value;
  // ExcelJS keeps strings literal. A formula requires a separate formula object.
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 32700);
}

function ledgerValue(header, value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) value = Array.isArray(value.richText) ? value.richText.map(part => part.text ?? '').join('') : value.result ?? value.text ?? null;
  if (value instanceof Date) {
    return dates.has(header) ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (identifiers.has(header) && value != null) return String(value);
  return header === 'Ergebnis' ? outcomeKey[value] ?? value : value;
}

function emptyRow(values) {
  return values.every(value => value == null || value === '');
}

function addTable(sheet, headers, rows) {
  sheet.addTable({
    name: sheet.name,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: {theme: 'TableStyleMedium2', showRowStripes: true},
    columns: headers.map(name => ({name, filterButton: true})),
    rows: rows.length ? rows : [headers.map(() => null)],
  });
}

function styleRow(row, headers) {
  let lines = 1;
  for (const [index, header] of headers.entries()) {
    const cell = row.getCell(index + 1);
    cell.font = {name: 'Arial', size: 10, color: {argb: 'FF243649'}};
    cell.numFmt = numberFormat(header);
    cell.alignment = {vertical: 'middle', wrapText: wrap.has(header)};
    const options = choices[row.worksheet.name]?.[header];
    if (options) cell.dataValidation = choiceValidation(options);
    if (wrap.has(header) && typeof cell.value === 'string') {
      const requiredLines = cell.value.split('\n').reduce(
        (total, line) => total + Math.max(1, Math.ceil(line.length / (columnWidth(header) - 4))), 0);
      lines = Math.max(lines, requiredLines);
    }
    if (header === 'Status' || header === 'Ergebnis') {
      const highlight = rowStatus[cell.value];
      cell.fill = highlight
        ? {type: 'pattern', pattern: 'solid', fgColor: {argb: highlight}}
        : {type: 'pattern', pattern: 'none'};
    }
  }
  row.height = Math.min(180, Math.max(23, lines * 14 + 9));
}

const choices = {
  Objekte: {Status: ['aktiv', 'zu prüfen']},
  Kreditoren: {Status: ['zu prüfen', 'geprüft']},
  Rechnungen: {Status: ['Erfasst', 'Klärung'], Belegart: ['Rechnung', 'Gutschrift', 'Abrechnung']},
  Rechnungspositionen: {Kategorie: ['Wartung', 'Reparatur', 'Energie', 'Wasser', 'Entsorgung', 'Versicherung', 'Reinigung', 'Sonstiges']},
};
function choiceValidation(values) {
  return {
    type: 'list', allowBlank: true, formulae: ['"' + values.join(',') + '"'],
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Auswahl prüfen',
    error: 'Bitte einen vorgeschlagenen Wert wählen oder die eigene Eingabe bewusst bestätigen.',
  };
}
function styleNewSheet(sheet, headers) {
  for (const [header, values] of Object.entries(choices[sheet.name] ?? {})) {
    const letter = sheet.getColumn(headers.indexOf(header) + 1).letter;
    // Bound template ranges: ExcelJS expands validations when loading a file.
    // Appended rows receive their own validation in styleRow, beyond row 1000 too.
    sheet.dataValidations.add(letter + '2:' + letter + '1000', choiceValidation(values));
  }
  for (const [index, header] of headers.entries()) {
    const column = sheet.getColumn(index + 1);
    column.width = columnWidth(header);
    column.numFmt = numberFormat(header);
  }
  const heading = sheet.getRow(1);
  heading.height = 32;
  heading.eachCell(cell => {
    cell.font = {name: 'Arial', size: 10, bold: true, color: {argb: 'FFFFFFFF'}};
    cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF233C54'}};
    cell.alignment = {vertical: 'top', wrapText: true};
  });
  styleRow(sheet.getRow(2), headers);
}

export function createWorkbook({demo = false} = {}) {
  const workbook = new ExcelJS.Workbook();
  for (const name of sheetNames) {
    const sheet = workbook.addWorksheet(name, {
      views: [{state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false}],
    });
    const headers = [...new Set([...(preferred[name] ?? []), ...columns[name]])];
    const rows = demo && name === 'Objekte'
      ? [headers.map(header => displayValue(header, demoObject[header]))]
      : [];
    addTable(sheet, headers, rows);
    styleNewSheet(sheet, headers);
  }
  return workbook;
}

export async function loadWorkbook(filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await fs.readFile(filename));
  return workbook;
}

export function readLedger(workbook) {
  const ledger = emptyLedger();
  for (const name of sheetNames) {
    const {headers, rows} = tableData(workbook, name);
    ledger[name] = rows.filter(row => !emptyRow(row)).map(row =>
      Object.fromEntries(headers.map((header, index) => [header, ledgerValue(header, row[index])])));
  }
  return ledger;
}

export function appendResult(workbook, result) {
  if (result.idempotent) return;
  const audit = result.audit;
  const source = audit.Auslesemodus === 'Demodaten' ? 'Demodaten' : audit['Mail-Konto'];
  const rowsBySheet = {
    Kreditoren: result.vendors,
    Rechnungen: result.invoices.map(invoice => ({...invoice, Kreditor_Name: audit.Kreditor})),
    Rechnungspositionen: result.positions.map(position => ({
      ...position, Rechnungsnummer: audit.Rechnungsnummer, 'Währung': audit['Währung'],
    })),
    Audit_Log: [{
      ...audit,
      Herkunft: source === 'Manueller Upload' ? 'Manueller PDF-Upload' : source,
      Ergebnis: outcomeLabel[audit.Ergebnis] ?? audit.Ergebnis,
    }],
  };
  for (const [name, records] of Object.entries(rowsBySheet)) {
    if (!records.length) continue;
    const {sheet, table, headers, rows, end} = tableData(workbook, name);
    const additions = records.map(record => headers.map(header => displayValue(header, record[header])));
    if (name === 'Audit_Log' && result.replaceAudit) {
      const idColumn = headers.indexOf('AuditID');
      const index = rows.findIndex(row => row[idColumn] === audit.AuditID);
      if (index < 0) throw Error('Vorhandene Auditzeile fehlt.');
      const row = sheet.getRow(index + 2);
      const managed = new Set([...preferred.Audit_Log, ...columns.Audit_Log]);
      additions[0].forEach((value, column) => {
        if (managed.has(headers[column])) row.getCell(column + 1).value = value;
      });
      styleRow(row, headers);
      continue;
    }
    while (rows.length && emptyRow(rows.at(-1))) rows.pop();
    for (let row = end + 1; row <= rows.length + additions.length + 1; row++) {
      if (!emptyRow(headers.map((_, index) => sheet.getCell(row, index + 1).value))) {
        throw Error(`Daten unterhalb der Tabelle ${name} verhindern das sichere Anhängen.`);
      }
    }
    // ExcelJS does not populate row data on tables loaded from disk.
    // Rebuild only the modified table from its existing cells, including formulas.
    sheet.removeTable(table.name);
    addTable(sheet, headers, [...rows, ...additions]);
    additions.forEach((_, index) => styleRow(sheet.getRow(rows.length + index + 2), headers));
  }
}

export async function saveWorkbook(workbook, filename) {
  await fs.mkdir(path.dirname(filename), {recursive: true});
  await fs.writeFile(filename, await workbook.xlsx.writeBuffer(), {mode: 0o600});
}
