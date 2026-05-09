import http from 'node:http';
import { createWriteStream, promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import Busboy from '@fastify/busboy';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/coolio-uploads';
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 1_500_000_000); // 1.5GB

await fs.mkdir(UPLOAD_DIR, { recursive: true });

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coolio Upload</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f7f7fb;background:#09090b}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:linear-gradient(180deg,#18181b,#111113);border:1px solid #2a2a31;border-radius:24px;padding:28px;box-shadow:0 24px 90px #0008}.kicker{color:#a78bfa;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}h1{margin:8px 0 6px;font-size:34px}.muted{color:#b7b7c4;line-height:1.55}.drop{margin:24px 0;padding:24px;border:1px dashed #52525b;border-radius:18px;background:#0c0c0f}input[type=file]{width:100%;padding:16px;border-radius:12px;background:#18181b;color:#fafafa;border:1px solid #333}button{margin-top:16px;padding:14px 18px;border:0;border-radius:12px;background:#7c3aed;color:white;font-weight:800;font-size:16px;cursor:pointer}button:hover{background:#8b5cf6}.files{margin-top:22px}.file{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #27272a}.file a{color:#c4b5fd}.ok{color:#86efac}.err{color:#fca5a5}code{background:#27272a;padding:2px 6px;border-radius:6px}</style></head><body><main class="card">${body}</main></body></html>`;
}
function send(res, status, body, type='text/html; charset=utf-8') { res.writeHead(status, {'content-type': type}); res.end(body); }
function safeName(name) { return basename(String(name || 'upload.bin')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160) || 'upload.bin'; }
async function listFiles() {
  const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes: true });
  const files = [];
  for (const e of entries) if (e.isFile()) {
    const p = join(UPLOAD_DIR, e.name); const st = await fs.stat(p);
    files.push({ name: e.name, size: st.size, mtime: st.mtime });
  }
  files.sort((a,b)=>b.mtime-a.mtime); return files;
}
function fmt(n){ if(n>1e9)return (n/1e9).toFixed(2)+' GB'; if(n>1e6)return (n/1e6).toFixed(1)+' MB'; if(n>1e3)return (n/1e3).toFixed(1)+' KB'; return n+' B'; }
async function renderHome(message='') {
  return html(`<div class="kicker">Reddi Agent Protocol</div><h1>Coolio file drop</h1><p class="muted">Upload Anusha’s demo here. Large video files are okay up to <code>${fmt(MAX_BYTES)}</code>. After upload, I can grab it from the protected drop and finish the under-3-minute close-out cut.</p>${message}<form class="drop" method="post" action="/upload" enctype="multipart/form-data"><input type="file" name="file" required><button type="submit">Upload file</button></form><p class="muted">Upload one file at a time. Leave the browser open until the success message appears.</p>`);
}
const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res,200,JSON.stringify({ok:true}), 'application/json');
    if (req.method === 'GET' && url.pathname === '/') return send(res,200, await renderHome());

    if (req.method === 'GET' && url.pathname === '/files') {
      const files = await listFiles();
      return send(res,200,JSON.stringify({files}, null, 2), 'application/json');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const name = basename(decodeURIComponent(url.pathname.slice('/files/'.length)));
      const path = join(UPLOAD_DIR, name);
      const st = await fs.stat(path);
      res.writeHead(200, {'content-type':'application/octet-stream','content-length':st.size,'content-disposition':`attachment; filename="${name.replace(/"/g,'')}"`});
      return createReadStreamCompat(path).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      let total=0, saved='';
      const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });
      bb.on('file', (_field, file, filename) => {
        const name = `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}-${safeName(filename)}`;
        saved = name;
        const out = createWriteStream(join(UPLOAD_DIR, name));
        file.on('data', chunk => { total += chunk.length; });
        file.pipe(out);
      });
      bb.on('finish', async () => send(res,200, await renderHome(`<p class="ok">Uploaded <strong>${saved}</strong> (${fmt(total)}). Loki can grab it now.</p>`)));
      bb.on('error', async err => send(res,400, await renderHome(`<p class="err">Upload failed: ${err.message}</p>`)));
      return req.pipe(bb);
    }
    return send(res,404, await renderHome('<p class="err">Not found.</p>'));
  } catch (err) { return send(res,500, html(`<p class="err">${String(err?.message || err)}</p>`)); }
});
function createReadStreamCompat(path){ return createReadStreamModule(path); }
import { createReadStream as createReadStreamModule } from 'node:fs';
server.listen(PORT, HOST, ()=> console.log(`coolio-upload listening on ${HOST}:${PORT}`));
