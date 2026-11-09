import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {processDocument} from './Server/engine.mjs';
import {appendResult, createWorkbook, loadWorkbook, readLedger, saveWorkbook} from './Server/workbook.mjs';
import {event, invoice} from './fixtures.mjs';

test('XLSX-Rundlauf erhält native Tabellen, Text-IDs und vorhandene Formeln', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'belege-workbook-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'test.xlsx');
  const workbook = createWorkbook({demo: true});

  const first = invoice({rechnungsnummer: '000123'});
  first.positionen[0].beschreibung = '=1+1';
  const firstEvent = event(first);
  firstEvent.meta.messageId = '2026-10-29T10:00:00.000Z';
  appendResult(workbook, processDocument(firstEvent, readLedger(workbook)));
  const positions = workbook.getWorksheet('Rechnungspositionen');
  const netColumn = positions.getRow(1).values.indexOf('Gesamt netto');
  positions.getCell(2, netColumn).value = {formula: 'D2*F2', result: 100};
  await saveWorkbook(workbook, filename);

  const loaded = await loadWorkbook(filename);
  const second = event(invoice({rechnungsnummer: '000124'}), 2);
  appendResult(loaded, processDocument(second, readLedger(loaded)));
  await saveWorkbook(loaded, filename);
  const roundTrip = await loadWorkbook(filename);
  const ledger = readLedger(roundTrip);

  assert.equal(roundTrip.worksheets.length, 6);
  for (const sheet of roundTrip.worksheets) assert.ok(sheet.getTable(sheet.name));
  assert.deepEqual(ledger.Rechnungen.map(row => row.Rechnungsnummer), ['000123', '000124']);
  assert.equal(ledger.Rechnungen[0].Datum, '2026-10-29');
  assert.equal(ledger.Audit_Log[0]['Mail-ID'], '2026-10-29T10:00:00.000Z');
  assert.equal(ledger.Rechnungspositionen[0].Beschreibung, '=1+1');
  assert.equal(ledger.Rechnungspositionen[0]['USt-Satz'], 0.19);
  const cell = roundTrip.getWorksheet('Rechnungspositionen').getCell(2, netColumn);
  assert.equal(cell.formula, 'D2*F2');
  assert.equal(cell.result, 100);
});
