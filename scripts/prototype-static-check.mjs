#!/usr/bin/env node
// Short-lived, local-only static demo smoke check. Uses the invoking Node runtime.
// node scripts/prototype-static-check.mjs [--root path/to/dist]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const port = 5176;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1])) {
  throw new Error('Usage: node prototype-static-check.mjs [--root dist-directory]');
}
const script = fileURLToPath(new URL('./prototype-static-server.mjs', import.meta.url));
const htmlHeaders = { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
let child;
let exitPromise;
let spawnError;
function request(target, { method = 'GET', headers = htmlHeaders } = {}) {
  // node:http preserves raw traversal targets, unlike fetch/new URL normalization.
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: target, method, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('HTTP check timed out.')));
    req.on('error', reject);
    req.end();
  });
}
async function verify(target, status, options) {
  const result = await request(target, options);
  assert.equal(result.headers['x-prototype-demo-pid'], String(child.pid), 'Response is not from this check child.');
  assert.equal(result.status, status, `${options?.method ?? 'GET'} ${target}`);
  assert.equal(result.headers['cache-control'], 'no-store', target);
  return result;
}
async function check() {
  // Never attach to, terminate, or silently reuse a pre-existing listener.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : resolve()));
  });
  child = spawn(process.execPath, [script, '--port', String(port), ...args], {
    stdio: 'inherit', windowsHide: true,
  });
  exitPromise = new Promise((resolve) => child.once('close', resolve));
  child.once('error', (error) => { spawnError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Static server exited before readiness.');
    try {
      const result = await request('/');
      assert.equal(result.headers['x-prototype-demo-pid'], String(child.pid), 'Port belongs to a different process.');
      assert.equal(result.status, 200, 'Homepage readiness failed.');
      ready = true;
      break;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
      await delay(100);
    }
  }
  assert.ok(ready, 'Static server did not become ready.');
  const home = await verify('/', 200);
  assert.match(home.headers['content-type'], /^text\/html\b/);
  assert.match(home.body, /<!doctype html|<html[\s>]/i);
  await verify('/', 200, { headers: { Accept: '*/*' } });
  assert.equal((await verify('/demo/deep-link', 200)).body, home.body);
  const js = home.body.match(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
  const css = home.body.match(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/i)?.[1];
  assert.ok(js && css, 'Built index.html must reference JS and CSS assets.');
  for (const [asset, type] of [[js, /^text\/javascript\b/], [css, /^text\/css\b/]]) {
    const url = new URL(asset, `http://127.0.0.1:${port}/`);
    assert.equal(url.origin, `http://127.0.0.1:${port}`, 'Assets must be local.');
    const result = await verify(url.pathname + url.search, 200, { headers: { Accept: '*/*' } });
    assert.match(result.headers['content-type'], type);
    assert.ok(result.body.length > 0);
  }
  await verify('/assets/__missing__.js', 404);
  await verify('/assets/__missing__', 404);
  await verify('/missing.css', 404);
  await verify('/demo/deep-link', 404, { headers: { Accept: '*/*' } });
  await verify('/demo/deep-link', 404, { headers: { Accept: 'text/html;q=0' } });
  await verify('/demo/deep-link', 404, { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'cors' } });
  for (const target of ['/api', '/api/demo', '/health', '/health/live', '/%61pi']) {
    const result = await verify(target, 503);
    assert.match(result.headers['content-type'], /^application\/json\b/);
    assert.equal(JSON.parse(result.body).demoOnly, true);
    assert.match(JSON.parse(result.body).error, /unavailable/i);
  }
  for (const target of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json',
    '/%252e%252e/package.json', '/..%5cpackage.json', '/C:%5cWindows', '/.env']) {
    const result = await request(target);
    assert.equal(result.headers['x-prototype-demo-pid'], String(child.pid));
    assert.ok([403, 404].includes(result.status), `Traversal was not rejected: ${target}`);
  }
  await verify('/%ZZ', 400);
  const post = await verify('/', 405, { method: 'POST' });
  assert.equal(post.headers.allow, 'GET, HEAD');
  const head = await verify('/', 200, { method: 'HEAD' });
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], home.headers['content-length']);
  console.log('PASS: HTML homepage/navigation, JS/CSS MIME, static 404, JSON API/health 503, traversal rejection, POST 405, HEAD and no-store.');
}
try {
  await check();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Only this exact ChildProcess is stopped: no port-based/process-name killing.
  if (child && child.exitCode === null && child.signalCode === null && child.pid) child.kill();
  if (exitPromise) await exitPromise;
}
