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

test('ein leeres gespeichertes Token darf keine Anmeldung ohne Passwort erlauben',async t=>{
  await assert.rejects(()=>startService(t,{storedToken:'   '}),/Verbindungstoken ist leer/);
});

test('zwei gleichzeitige identische Zustellungen schreiben und quittieren genau einmal',async t=>{
  const {directory,request}=await startService(t);
  const input=event();
  const results=await Promise.all([request('/demo/process',input),request('/demo/process',input)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.deepEqual(results.map(r=>r.data.idempotent).sort(),[false,true]);
  const ledger=readLedger(await loadWorkbook(path.join(directory,'demo-rechnungen.xlsx')));
  assert.equal(ledger.Rechnungen.length,1);assert.equal(ledger.Audit_Log.length,1);
});

test('Warteschlangenzähler ignoriert Systemdateien und Verzeichnisse',async t=>{
  const {directory,request}=await startService(t);
  const pending=path.join(directory,'private/pending');await fs.mkdir(pending);
  await fs.writeFile(path.join(pending,'.DS_Store'),'ignored');
  await fs.mkdir(path.join(pending,'folder.json'));
  await fs.writeFile(path.join(pending,'saved.json'),'{}');
  assert.equal((await request('/pending')).data.anzahl,1);
});

test('eine beschädigte Wartedatei blockiert keine weiteren wiederholbaren Belege',async t=>{
  const {directory,request}=await startService(t);
  const pending=path.join(directory,'private/pending');await fs.mkdir(pending);
  await fs.writeFile(path.join(pending,'a-broken.json'),'{broken');
  const input=event();input.response.content[0].text=JSON.stringify({...JSON.parse(input.response.content[0].text),belegart:'Sonstiges'});
  await fs.writeFile(path.join(pending,'b-valid.json'),JSON.stringify(input));
  const response=await request('/replay',{});
  assert.equal(response.status,207);assert.equal(response.data.ok,false);
  assert.equal(response.data.results.length,1);assert.equal(response.data.results[0].ergebnis,'kein Beleg');
  assert.equal(response.data.failed[0].file,'a-broken.json');
  assert.equal((await request('/pending')).data.anzahl,1);
});

test('ungültige Portkonfiguration hat eine verständliche Startmeldung',async t=>{
  for(const port of ['-1','1.5','abc','65536',''])await assert.rejects(()=>startService(t,{port}),/BELEGE_PORT muss/);
});

test('doppelter Serverstart erklärt den bereits belegten Port',async t=>{
  const first=await startService(t);
  await assert.rejects(()=>startService(t,{port:new URL(first.address).port}),/bereits belegt/);
});

test('falsche HTTP-Methode nennt die erlaubte Methode',async t=>{
  const {raw}=await startService(t);
  const response=await raw('/process');
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');await response.json();
  assert.equal((await raw('/does-not-exist')).status,404);
});
