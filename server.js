// Node server for playing on your own PC: static files + the shared room hub over HTTP/SSE.
// Rooms are saved to data/rooms.json so a restart (or a closed tab) never loses a game.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHub } = require('./hub.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const SAVE = path.join(__dirname, 'data', 'rooms.json');

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(SAVE, 'utf8')); console.log(`복원된 방: ${Object.keys(rooms).length}개`); } catch {}

let saveTimer = null;
function saveAll() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(SAVE), { recursive: true });
    fs.writeFileSync(SAVE + '.tmp', JSON.stringify(hub.rooms));
    fs.renameSync(SAVE + '.tmp', SAVE);
  }, 200);
}
const hub = createHub({ save: saveAll, remove: saveAll }, rooms);

function events(req, res, q) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let off;
  try {
    off = hub.connect(String(q.get('room') || '').toUpperCase(), q.get('token'), (data) => res.write(`data: ${JSON.stringify(data)}\n\n`));
  } catch (e) {
    res.statusCode = 404; return res.end(e.message);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); off(); });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/events') return events(req, res, url.searchParams);
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const out = hub.handle(req.method, url.pathname, raw ? JSON.parse(raw) : {});
        if (out === undefined) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
        res.end(JSON.stringify(out));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  const file = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`♠ 홀덤 서버 실행 중: http://localhost:${PORT}`));
