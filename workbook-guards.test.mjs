import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkbook,readLedger,appendResult,saveWorkbook,loadWorkbook} from './Server/workbook.mjs';
import {processDocument} from './Server/engine.mjs';
import {event,invoice} from './fixtures.mjs';
const cell=(book,sheet,header,row=2)=>{const ws=book.getWorksheet(sheet);return ws.getCell(row,ws.getRow(1).values.indexOf(header));};

test('Rechnungsnummern aus Formelergebnissen bleiben Kennungen und verhindern Dubletten',()=>{
  const workbook=createWorkbook({demo:true});
  appendResult(workbook,processDocument(event(invoice({rechnungsnummer:'123'})),readLedger(workbook)));
  cell(workbook,'Rechnungen','Rechnungsnummer').value={formula:'123',result:123};
  const ledger=readLedger(workbook);
  assert.equal(ledger.Rechnungen[0].Rechnungsnummer,'123');
  const result=processDocument(event(invoice({rechnungsnummer:'123'}),2),ledger);
  assert.equal(result.audit.Ergebnis,'Dublette');assert.equal(result.invoices.length,0);
});

test('teilweise formatierte Kreditorennamen bleiben beim Namensabgleich erhalten',()=>{
  const workbook=createWorkbook({demo:true});
  appendResult(workbook,processDocument(event(),readLedger(workbook)));
  cell(workbook,'Kreditoren','Name').value={richText:[{text:'DEMO '},{text:'Haustechnik GmbH',font:{bold:true}}]};
  const ledger=readLedger(workbook);
  assert.equal(ledger.Kreditoren[0].Name,'DEMO Haustechnik GmbH');
  const document=invoice({rechnungsnummer:'NAME-002'});document.kreditor.ust_id=null;document.kreditor.iban=null;
  const result=processDocument(event(document,2),ledger);
  assert.equal(result.audit.Kreditorabgleich,'Name');assert.equal(result.vendors.length,0);
});
