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

test('Fremdwährungen werden als solche ausgewiesen und nicht als Euro formatiert',()=>{
  const workbook=createWorkbook({demo:true});
  appendResult(workbook,processDocument(event(invoice({waehrung:'USD'})),readLedger(workbook)));
  const ledger=readLedger(workbook);
  for(const sheet of ['Rechnungen','Rechnungspositionen','Audit_Log'])assert.equal(ledger[sheet][0]['Währung'],'USD');
  assert.equal(ledger.Rechnungen[0].Brutto,119);
  assert.doesNotMatch(cell(workbook,'Rechnungen','Brutto').numFmt,/€/);
  assert.match(ledger.Audit_Log[0].Probleme,/nicht EUR/);
});

test('neue Tabellen bieten gespeicherte Auswahllisten zur manuellen Nachprüfung',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'belege-lists-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'lists.xlsx');await saveWorkbook(createWorkbook(),file);
  const workbook=await loadWorkbook(file);
  assert.equal(cell(workbook,'Objekte','Status').dataValidation.type,'list');
  assert.match(cell(workbook,'Rechnungen','Belegart').dataValidation.formulae[0],/Gutschrift/);
  assert.match(cell(workbook,'Rechnungspositionen','Kategorie',100).dataValidation.formulae[0],/Reparatur/);
});
