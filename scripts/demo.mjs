import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {demoEvents} from '../fixtures.mjs';
import {processDocument} from '../Server/engine.mjs';
import {appendResult, createWorkbook, readLedger} from '../Server/workbook.mjs';

export async function runOfflineDemo(filename) {
  const workbook = createWorkbook({demo: true});
  const results = [];
  for (const input of demoEvents()) {
    input.mode = 'Demodaten';
    const result = processDocument(input, readLedger(workbook));
    appendResult(workbook, result);
    results.push({dateiname: input.meta.filename, ergebnis: result.audit.Ergebnis});
  }
  const ledger = readLedger(workbook);
  const output = path.resolve(filename);
  await fs.mkdir(path.dirname(output), {recursive: true});
  // Exclusive creation protects a previous demonstration or reviewed result.
  await fs.writeFile(output, await workbook.xlsx.writeBuffer(), {flag: 'wx', mode: 0o600});
  return {datei: output, rechnungen: ledger.Rechnungen.length,
    kreditoren: ledger.Kreditoren.length, auditZeilen: ledger.Audit_Log.length, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--output')) {
      throw Error('Aufruf: npm run demo -- [--output PFAD.xlsx]');
    }
    const filename = args[1] ?? fileURLToPath(new URL('../data/offline-demo.xlsx', import.meta.url));
    if (path.extname(filename).toLowerCase() !== '.xlsx') throw Error('Ausgabedatei muss auf .xlsx enden.');
    console.log(JSON.stringify(await runOfflineDemo(filename), null, 2));
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? 'Ausgabedatei existiert bereits. Mit --output einen neuen Dateinamen wählen.'
      : error.message);
    process.exitCode = 1;
  }
}
