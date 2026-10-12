#!/usr/bin/env node
// Local static DEMO only: no API proxy, authentication, or production hardening.
// node scripts/prototype-static-server.mjs [--port 5175] [--root path/to/dist]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let root = path.join(projectRoot, 'src/frontend/dist');
let port = 5175;
for (let i = 2; i < process.argv.length; i += 2) {
  const option = process.argv[i];
  const value = process.argv[i + 1];
  if (option === '--root' && value) root = path.resolve(value);
  else if (option === '--port' && /^\d+$/.test(value ?? '') && +value > 0 && +value <= 65535) port = +value;
  else throw new Error('Usage: node prototype-static-server.mjs [--port 5175] [--root dist-directory]');
}
root = await realpath(root);
if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('Build the frontend first: index.html is missing.');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};
const insideRoot = (target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
async function findFile(target) {
  try {
    const resolved = await realpath(target);
    if (!insideRoot(resolved)) return { forbidden: true };
    return (await stat(resolved)).isFile() ? { file: resolved } : {};
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return {};
    if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return { forbidden: true };
    throw error;
  }
}
function isPageNavigation(request, pathname) {
  const acceptsHtml = (request.headers.accept ?? '').split(',').some((entry) => {
    const [type, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    return type === 'text/html' && (!quality || Number(quality.trim().slice(2)) > 0);
  });
  const mode = request.headers['sec-fetch-mode'];
  const destination = request.headers['sec-fetch-dest'];
  return acceptsHtml && (!mode || mode === 'navigate')
    && (!destination || ['document', 'iframe'].includes(destination))
    && !path.posix.extname(pathname) && !/^\/assets(?:\/|$)/i.test(pathname);
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // Lets the local check identify its own child rather than an unrelated listener.
  response.setHeader('X-Prototype-Demo-Pid', String(process.pid));
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  };
  const fail = (status, message) => send(status, JSON.stringify({ error: message, demoOnly: true }));
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return fail(405, 'Only GET and HEAD are supported by this static demo server.');
    }
    // Decode the raw request target BEFORE URL normalization can erase traversal.
    const raw = (request.url ?? '').split('?')[0];
    let pathname;
    try { pathname = decodeURIComponent(raw); } catch { return fail(400, 'Invalid URL encoding.'); }
    if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\:\x00-\x1f\x7f]/.test(pathname)
      || /%[0-9a-f]{2}/i.test(pathname)
      || pathname.split('/').some((part) => part.startsWith('.') || /[. ]$/.test(part)
        || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
      return fail(403, 'Unsafe path is forbidden.');
    }
    if (/^\/(api|health)(?:\/|$)/i.test(pathname)) {
      return fail(503, 'Static demonstration only: backend API and health service are unavailable; no development proxy is included.');
    }
    const target = path.resolve(root, pathname === '/' ? './index.html' : `.${pathname}`);
    if (!insideRoot(target)) return fail(403, 'Path is outside the static root.');
    let found = await findFile(target);
    if (found.forbidden) return fail(403, 'Path is outside the static root or inaccessible.');
    if (!found.file && isPageNavigation(request, pathname)) found = await findFile(path.join(root, 'index.html'));
    if (found.forbidden) return fail(403, 'Path is outside the static root or inaccessible.');
    if (!found.file) return fail(404, 'Static file not found.');
    send(200, await readFile(found.file), mime[path.extname(found.file).toLowerCase()] ?? 'application/octet-stream');
  } catch (error) {
    if (!response.headersSent) fail(error.code === 'ENOENT' ? 404 : 500, 'Static demo file could not be served.');
    else response.destroy();
  }
});
server.on('error', (error) => {
  console.error(`Static demo server failed (${error.code ?? 'unknown error'}). No alternate port will be selected.`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`DEMO ONLY (not production): http://127.0.0.1:${port}; static root: ${root}`);
});
