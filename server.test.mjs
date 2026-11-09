import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {demoEvents, event, invoice, demoObject} from './fixtures.mjs';
import {loadWorkbook, readLedger, saveWorkbook} from './Server/workbook.mjs';

test('HTTP-Dienst schreibt XLSX, erkennt neue Zustellungen und wiederholt offene Vorgänge', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'belege-http-'));
  const server = spawn(process.execPath, ['Server/server.mjs'], {
    cwd: import.meta.dirname,
    env: {...process.env, BELEGE_DATA_DIR:directory, BELEGE_PORT:'0'},
    stdio:['ignore','pipe','pipe'],
  });
  const stopped = once(server, 'exit');
  let diagnostics = '';
  server.stderr.on('data', data => { diagnostics += data; });
  try {
    const address = await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(Error('Server startet nicht. ' + diagnostics)), 15000);
      let output = '';
      server.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {clearTimeout(timeout);resolve('http://127.0.0.1:' + match[1]);}
      });
      server.once('error', error => {clearTimeout(timeout);reject(error);});
      server.once('exit', () => {clearTimeout(timeout);reject(Error(diagnostics));});
    });
    const token = (await fs.readFile(path.join(directory,'private/bridge-token'),'utf8')).trim();
    const request = async (route,input,auth=token) => {
      const response = await fetch(address + route,{
        method:input===undefined?'GET':'POST',
        headers:{'content-type':'application/json','x-belege-token':auth},
        body:input===undefined?undefined:JSON.stringify(input),
      });
      return {status:response.status, data:await response.json()};
    };
    assert.equal((await request('/health')).status,200);
    assert.equal((await request('/pending',undefined,'wrong-token')).status,401);
    const results=[];
    for (const item of demoEvents()) results.push((await request('/demo/process',item)).data);
    assert.deepEqual(results.map(row=>row.ergebnis),[
      'geschrieben','Dublette','geschrieben','geschrieben',
      'Objekt unbekannt','kein Beleg','geschrieben','Fehler',
    ]);
    assert.ok(results.every(row=>row.auslesemodus==='Demodaten' && row.dauer_s>=0));
    const demo = path.join(directory,'demo-rechnungen.xlsx');
    const before = readLedger(await loadWorkbook(demo));
    assert.equal(before.Rechnungen.length,4);
    assert.equal(before.Kreditoren.length,1);
    assert.equal(before.Audit_Log.length,8);
    assert.equal((await request('/demo/process',demoEvents()[0])).data.idempotent,true);
    const concurrent = await Promise.all([
      request('/demo/process',event(invoice({rechnungsnummer:'DEMO-PARALLEL'}),100)),
      request('/demo/process',event(invoice({rechnungsnummer:'DEMO-PARALLEL'}),101)),
    ]);
    assert.deepEqual(concurrent.map(row=>row.data.ergebnis).sort(),['Dublette','geschrieben']);
    assert.equal(readLedger(await loadWorkbook(demo)).Rechnungen.length,5);

    const filename = path.join(directory,'rechnungen.xlsx');
    const workbook = await loadWorkbook(filename);
    const object = workbook.getWorksheet('Objekte');
    const headers = object.getRow(1).values.slice(1);
    object.getRow(2).values = headers.map(header=>demoObject[header]??null);
    await saveWorkbook(workbook,filename);
    const input = event(invoice(),200);
    const lock = path.join(directory,'~$rechnungen.xlsx');
    await fs.writeFile(lock,'test');
    assert.equal((await request('/process',input)).status,503);
    assert.equal((await request('/pending')).data.anzahl,1);
    await fs.unlink(lock);
    const replay = await request('/replay',{});
    assert.equal(replay.status,200);
    assert.equal(replay.data.results[0].ergebnis,'geschrieben');
    assert.equal((await request('/pending')).data.anzahl,0);
    const after = readLedger(await loadWorkbook(filename));
    assert.equal(after.Rechnungen.length,1);
    assert.equal(after.Audit_Log.length,1);
  } finally {
    server.kill('SIGTERM');
    await stopped;
    await fs.rm(directory,{recursive:true,force:true});
  }
});
