import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav', '.map': 'application/json' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { 'content-type': types[extname(path)] ?? 'text/plain' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(4188, '127.0.0.1', () => console.log('open http://127.0.0.1:4188/scripts/smoke/smoke.html (add ?mode=stage for the stage layout)'));

