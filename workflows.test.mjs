import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {apiSchema, model, prompt} from './Server/schema.mjs';

const filenames = [
  '01-rechnungsverarbeitung.json',
  '02-demotest.json',
  '03-excel-wiederholung.json',
];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function loadExport(filename) {
  const url = new URL('./workflows/' + filename, import.meta.url);
  const source = await fs.readFile(url, 'utf8');
  return {source, workflow: JSON.parse(source)};
}

for (const filename of filenames) {
  test(filename + ' ist ein lesbarer Workflow mit eindeutigen Knoten', async () => {
    const {workflow} = await loadExport(filename);
    assert.equal(typeof workflow.name, 'string');
    assert.ok(workflow.name.trim());
    assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0);
    for (const node of workflow.nodes) {
      assert.equal(typeof node.name, 'string');
      assert.ok(node.name.trim());
      assert.equal(typeof node.id, 'string');
      assert.ok(node.id.trim());
    }
    assert.equal(new Set(workflow.nodes.map(node => node.name)).size, workflow.nodes.length);
    assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
  });

  test(filename + ' verbindet ausschließlich vorhandene Knoten', async () => {
    const {workflow} = await loadExport(filename);
    const names = new Set(workflow.nodes.map(node => node.name));
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source), 'Verbindungsquelle fehlt: ' + source);
      for (const [type, branches] of Object.entries(outputs)) {
        assert.ok(Array.isArray(branches));
        for (const branch of branches) {
          assert.ok(Array.isArray(branch));
          for (const connection of branch) {
            assert.ok(names.has(connection.node), 'Verbindungsziel fehlt: ' + connection.node);
            assert.equal(connection.type, type);
            assert.ok(Number.isInteger(connection.index) && connection.index >= 0);
          }
        }
      }
    }
  });

  test(filename + ' enthält syntaktisch gültige Code-Knoten', async () => {
    const {workflow} = await loadExport(filename);
    for (const node of workflow.nodes.filter(item => item.type === 'n8n-nodes-base.code')) {
      assert.equal(typeof node.parameters.jsCode, 'string');
      assert.ok(node.parameters.jsCode.trim());
      assert.doesNotThrow(() => new AsyncFunction(node.parameters.jsCode), node.name);
    }
  });

  test(filename + ' ist inaktiv und enthält keine gepinnten Ausführungsdaten', async () => {
    const {workflow} = await loadExport(filename);
    assert.equal(workflow.active, false);
    assert.deepEqual(workflow.pinData, {});
  });

  test(filename + ' enthält keine exportierten Credentials oder API-Schlüssel', async () => {
    const {source, workflow} = await loadExport(filename);
    assert.ok(!Object.hasOwn(workflow, 'credentials'));
    for (const node of workflow.nodes) {
      assert.ok(!Object.hasOwn(node, 'credentials'), node.name);
    }
    assert.doesNotMatch(source, /sk-ant-[A-Za-z0-9_-]{20,}/);
    assert.doesNotMatch(source, /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/);
  });
}

test('Claude-Anfrage im Export verwendet das aktuelle Modell, den Prompt und das API-Schema', async () => {
  const {workflow} = await loadExport('01-rechnungsverarbeitung.json');
  const node = workflow.nodes.find(item => item.name === 'Claude Anfrage');
  assert.ok(node);
  const input = {
    meta: {filename: 'synthetischer-test.pdf', messageId: 'synthetischer-request'},
    pdfBase64: Buffer.from('%PDF-1.7\nsynthetischer Test').toString('base64'),
  };
  const buildRequest = new AsyncFunction('$json', node.parameters.jsCode);
  const result = await buildRequest(input);
  const request = result.json.request;

  assert.equal(request.model, model);
  assert.equal(request.system, prompt);
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema, apiSchema);
  assert.equal(request.messages[0].role, 'user');
  assert.deepEqual(request.messages[0].content[0], {
    type: 'document',
    source: {type: 'base64', media_type: 'application/pdf', data: input.pdfBase64},
  });
  assert.equal(result.json.meta.messageId, input.meta.messageId);
  assert.ok(Number.isFinite(result.json.meta.processingStartedAt));
});
