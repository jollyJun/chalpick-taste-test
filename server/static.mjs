import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { SECURITY_HEADERS } from './security.mjs';

const compress = promisify(brotliCompress);
const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.avif': 'image/avif', '.woff2': 'font/woff2' });

function inside(root, file) {
  return file === root || file.startsWith(root + path.sep);
}

function privatePath(value) {
  return /[\\:\u0000-\u001f\u007f]/u.test(value) || value.split('/').some(segment => segment.startsWith('.')) || /(?:\.private\.|source-audit\.json$|catalog-age-ratings\.json$)/i.test(value);
}

function sendError(response, status, extra = {}) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  response.end(status === 405 ? '허용되지 않은 요청입니다.' : '페이지를 찾을 수 없습니다.');
}

function acceptsBrotli(header) {
  return String(header || '').split(',').some(value => {
    const [encoding, ...parameters] = value.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => /^\s*q\s*=/.test(parameter));
    return encoding === 'br' && (!quality || Number(quality.split('=')[1]) > 0);
  });
}

export function createStaticHandler(directory) {
  const rootPromise = realpath(directory);
  const encodedFiles = new Map();
  return async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return sendError(response, 405, { Allow: 'GET, HEAD' });
    try {
      const root = await rootPromise;
      const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (requested.length > 4096 || privatePath(requested)) return sendError(response, 404);
      let file = path.resolve(root, '.' + requested);
      if (!inside(root, file)) return sendError(response, 404);
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      file = await realpath(file);
      const extension = path.extname(file).toLowerCase();
      if (!inside(root, file) || privatePath(path.relative(root, file).split(path.sep).join('/')) || !Object.hasOwn(MIME, extension)) return sendError(response, 404);
      const info = await stat(file);
      if (!info.isFile()) return sendError(response, 404);
      const immutable = /\/(?:data\/(?:live-catalog|catalog-part|catalog-meta)\.[a-f0-9]+\.json|assets\/covers\/[a-f0-9]+\.webp)$/.test(requested);
      const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[extension], 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', Vary: 'Accept-Encoding' };
      if (request.method === 'HEAD') {
        response.writeHead(200, { ...headers, 'Content-Length': info.size });
        response.end();
        return;
      }
      let content;
      if (acceptsBrotli(request.headers['accept-encoding']) && ['.html', '.css', '.js', '.json', '.svg'].includes(extension)) {
        const key = `${file}:${info.mtimeMs}`;
        if (!encodedFiles.has(key)) {
          if (encodedFiles.size >= 32) encodedFiles.delete(encodedFiles.keys().next().value);
          encodedFiles.set(key, readFile(file).then(buffer => compress(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).catch(error => { encodedFiles.delete(key); throw error; }));
        }
        content = await encodedFiles.get(key);
        headers['Content-Encoding'] = 'br';
      } else content = await readFile(file);
      response.writeHead(200, headers);
      response.end(content);
    } catch {
      sendError(response, 404);
    }
  };
}
