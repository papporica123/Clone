// Ganesh clone - tiny two-person chat server. Zero dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 7860;
const PASSCODE = process.env.ROOM_PASSCODE || 'ganesh';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_MSGS = 500;

let messages = [];
try { messages = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
function save() { fs.writeFile(DATA_FILE, JSON.stringify(messages), () => {}); }

const secret = crypto.randomBytes(32).toString('hex');
const sign = (name) => crypto.createHmac('sha256', secret).update(name).digest('hex');
const makeToken = (name) => Buffer.from(name).toString('base64url') + '.' + sign(name);
function readToken(t) {
  if (!t || typeof t !== 'string' || !t.includes('.')) return null;
  const [b, sig] = t.split('.');
  let name; try { name = Buffer.from(b, 'base64url').toString(); } catch (e) { return null; }
  const good = sign(name);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return name;
}

const clients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { resolve({}); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { name, passcode } = await body(req);
    const n = String(name || '').trim().slice(0, 30);
    if (!n) return json(res, 400, { error: 'Enter a name' });
    if (passcode !== PASSCODE) return json(res, 401, { error: 'Wrong passcode' });
    return json(res, 200, { token: makeToken(n), name: n });
  }

  if (req.method === 'GET' && url.pathname === '/api/stream') {
    const name = readToken(url.searchParams.get('token'));
    if (!name) return json(res, 401, { error: 'Not logged in' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: history\ndata: ${JSON.stringify(messages)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/send') {
    const b = await body(req);
    const name = readToken(b.token);
    if (!name) return json(res, 401, { error: 'Not logged in' });
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) return json(res, 400, { error: 'Empty message' });
    const msg = { id: crypto.randomUUID(), from: name, text, ts: Date.now() };
    messages.push(msg);
    if (messages.length > MAX_MSGS) messages = messages.slice(-MAX_MSGS);
    save();
    broadcast(msg);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Ganesh clone running on port ${PORT}`));
