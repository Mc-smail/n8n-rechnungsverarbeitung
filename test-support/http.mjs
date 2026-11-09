import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

export async function startService(t, {storedToken, port = '0'} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'belege-http-'));
  if(storedToken!==undefined){
    await fs.mkdir(path.join(directory,'private'));
    await fs.writeFile(path.join(directory,'private/bridge-token'),storedToken);
  }
  const server = spawn(process.execPath, ['Server/server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, BELEGE_DATA_DIR: directory, BELEGE_PORT: port},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = once(server, 'exit');
  let diagnostics = '';
  server.stderr.on('data', data => { diagnostics += data; });
  t.after(async () => {
    server.kill('SIGTERM');
    await stopped;
    await fs.rm(directory, {recursive: true, force: true});
  });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Server startet nicht. ' + diagnostics)), 15000);
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
    });
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', () => { clearTimeout(timeout); reject(Error(diagnostics)); });
  });
  const token = (await fs.readFile(path.join(directory, 'private/bridge-token'), 'utf8')).trim();
  const raw = (route, options = {}) => fetch(address + route, {
    ...options, headers: {'x-belege-token': token, ...options.headers},
  });
  const request = async (route, input, auth = token) => {
    const response = await raw(route, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {'content-type': 'application/json', 'x-belege-token': auth},
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return {status: response.status, data: await response.json()};
  };
  return {directory, address, token, raw, request};
}
