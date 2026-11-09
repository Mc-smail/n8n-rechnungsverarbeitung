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
