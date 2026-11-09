import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadWorkbook, readLedger} from './Server/workbook.mjs';
const exec = promisify(execFile);

test('Offline-Demo erzeugt acht nachvollziehbare Audits und überschreibt kein Ergebnis', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'belege-offline-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'test ergebnis.xlsx');
  const args = ['scripts/demo.mjs', '--output', filename];
  const {stdout} = await exec(process.execPath, args, {cwd: import.meta.dirname});
  const summary = JSON.parse(stdout);
  assert.equal(summary.rechnungen, 4); assert.equal(summary.auditZeilen, 8);
  const bytes = await fs.readFile(filename);
  const ledger = readLedger(await loadWorkbook(filename));
  assert.equal(ledger.Audit_Log.length, 8);
  assert.ok(ledger.Audit_Log.every(row => row.Auslesemodus === 'Demodaten'));
  await assert.rejects(() => exec(process.execPath, args, {cwd: import.meta.dirname}),
    error => error.code === 1 && /existiert bereits/.test(error.stderr));
  assert.deepEqual(await fs.readFile(filename), bytes);
});

test('Offline-Demo erklärt ungültige Argumente', async () => {
  await assert.rejects(() => exec(process.execPath, ['scripts/demo.mjs', '--unknown']),
    error => error.code === 1 && /Aufruf/.test(error.stderr));
});
