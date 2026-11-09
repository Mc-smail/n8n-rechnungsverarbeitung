import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startService} from './test-support/http.mjs';
import {event} from './fixtures.mjs';
import {loadWorkbook, readLedger} from './Server/workbook.mjs';

test('ungültiges JSON ist ein Eingabefehler und bleibt außerhalb der Schreibwarteschlange',async t=>{
  const {raw,request}=await startService(t);
  const response=await raw('/process',{method:'POST',headers:{'content-type':'application/json'},body:'{kaputt'});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/JSON/);
  assert.equal((await request('/pending')).data.anzahl,0);
});

test('Verarbeitungsendpunkte verlangen JSON als Medientyp',async t=>{
  const {raw}=await startService(t);
  for(const contentType of ['text/plain','application/octet-stream']){
    const response=await raw('/process',{method:'POST',headers:{'content-type':contentType},body:'{}'});
    assert.equal(response.status,415);await response.json();
  }
});

test('zu große Anfragen liefern HTTP 413 statt eines Verbindungsabbruchs',async t=>{
  const {raw,request}=await startService(t);
  const response=await raw('/process',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(32*1024*1024+1)});
  assert.equal(response.status,413);await response.json();
  assert.equal((await request('/health')).status,200);
});

test('fehlende und falsch typisierte Herkunft wird vor dem Schreiben abgewiesen',async t=>{
  const {request}=await startService(t);
  for(const input of [null,[],{}, {meta:{filename:'  ',messageId:'1'}},{meta:{filename:{name:'a.pdf'},messageId:'1'}},{meta:{filename:'a.pdf',messageId:42}},{meta:{filename:'a.pdf',messageId:'   '}}]){
    assert.equal((await request('/process',input)).status,400);
  }
  assert.equal((await request('/pending')).data.anzahl,0);
});

test('binäre PDF-Daten müssen als Base64-Text übergeben werden',async t=>{
  const {request}=await startService(t);
  for(const pdfBase64 of [42,{},[]])assert.equal((await request('/process',{...event(),pdfBase64})).status,400);
  assert.equal((await request('/pending')).data.anzahl,0);
});

test('fehlende Ausleseantwort erzeugt einen nachvollziehbaren Fehleraudit',async t=>{
  const {directory,request}=await startService(t);
  const result=await request('/demo/process',{meta:event().meta});
  assert.equal(result.status,200);assert.equal(result.data.ergebnis,'Fehler');
  const ledger=readLedger(await loadWorkbook(path.join(directory,'demo-rechnungen.xlsx')));
  assert.equal(ledger.Rechnungen.length,0);assert.equal(ledger.Audit_Log.length,1);
  assert.match(ledger.Audit_Log[0].Probleme,/keinen lesbaren JSON/);
});
