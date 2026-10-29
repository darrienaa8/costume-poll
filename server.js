'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Poll } = require('./lib/poll');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'poll.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const poll = new Poll(DATA_FILE, process.env.HOST_KEY);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PAGES = { '/': 'index.html', '/results': 'results.html', '/host': 'host.html', '/qr': 'qr.html' };

/* ---------- helpers ---------- */

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4096) {
        if (!tooBig) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
        tooBig = true;
        return; // keep draining so the 413 can be delivered
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (_) {
        reject(Object.assign(new Error('Bad request.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Anonymous per-device id kept in a cookie. Issued on first contact. */
function deviceFor(req, res) {
  let dev = getCookie(req, 'cp_dev');
  if (!dev || !/^[a-f0-9]{24}$/.test(dev)) {
    dev = crypto.randomBytes(12).toString('hex');
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `cp_dev=${dev}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`);
  }
  return dev;
}

function isHost(req) {
  const given = crypto.createHash('sha256').update(String(req.headers['x-host-key'] || '')).digest();
  const real = crypto.createHash('sha256').update(poll.hostKey).digest();
  return crypto.timingSafeEqual(given, real);
}

/* ---------- API ---------- */

async function handleApi(req, res, p) {
  if (req.method === 'GET' && p === '/api/status') {
    const dev = deviceFor(req, res);
    return sendJson(res, 200, { pollId: poll.pollId, voted: poll.hasVoted(dev) });
  }

  if (req.method === 'GET' && p === '/api/results') {
    return sendJson(res, 200, poll.results());
  }

  if (req.method === 'POST' && p === '/api/vote') {
    const dev = deviceFor(req, res);
    const body = await readJson(req);
    // Checked after the body is read so two quick taps can't both slip through.
    if (poll.hasVoted(dev)) return sendJson(res, 409, { error: 'already_voted', pollId: poll.pollId });
    const text = String(body.text == null ? '' : body.text)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return sendJson(res, 400, { message: 'Type a costume first.' });
    if (text.length > 60) return sendJson(res, 400, { message: 'Keep it under 60 characters.' });
    if (!/[\p{L}\p{N}]/u.test(text)) return sendJson(res, 400, { message: 'Use at least one letter or number.' });
    poll.addVote(text, dev);
    return sendJson(res, 200, { ok: true, pollId: poll.pollId });
  }

  if (p.startsWith('/api/host/')) {
    if (!isHost(req)) return sendJson(res, 401, { message: 'Wrong host key.' });
    if (req.method === 'GET' && p === '/api/host/state') return sendJson(res, 200, poll.hostState());
    if (req.method === 'POST') {
      const body = await readJson(req);
      try {
        if (p === '/api/host/merge') {
          const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
          poll.merge(ids, body.into == null ? null : Number(body.into));
        } else if (p === '/api/host/split') {
          poll.split(Number(body.groupId), String(body.variant));
        } else if (p === '/api/host/rename') {
          poll.rename(Number(body.groupId), body.name);
        } else if (p === '/api/host/reset') {
          poll.reset();
        } else {
          return sendJson(res, 404, { message: 'Not found.' });
        }
      } catch (e) {
        return sendJson(res, 400, { message: e.message });
      }
      return sendJson(res, 200, poll.hostState());
    }
  }

  return sendJson(res, 404, { message: 'Not found.' });
}

/* ---------- static files ---------- */

function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  const rel = PAGES[p] || decodeURIComponent(p).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nothing here... boo! 👻');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/api/')) return await handleApi(req, res, p);
    return serveStatic(req, res, p);
  } catch (e) {
    if (res.headersSent) return res.end();
    sendJson(res, e.status || 500, { message: e.status ? e.message : 'Something went wrong.' });
  }
});

server.listen(PORT, () => {
  const lan = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
  }
  console.log('\n🎃  Costume poll is running\n');
  console.log(`  Guests (this computer):  http://localhost:${PORT}/`);
  for (const ip of lan) console.log(`  Guests (same Wi-Fi):     http://${ip}:${PORT}/`);
  console.log(`  Host view (keep private): http://localhost:${PORT}/host?key=${poll.hostKey}`);
  console.log(`  Printable QR code:        http://localhost:${PORT}/qr`);
  console.log(`  Host key:                 ${poll.hostKey}\n`);
});
