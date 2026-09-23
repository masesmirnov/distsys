'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

const PORT = Number(process.env.PORT) || 8094;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

const BODY_LIMIT = 64 * 1024;
const ROOM_LIMIT = 32;
const PEER_LIMIT = 40;
const STREAMS_PER_ADDRESS = 12;
const STROKE_LIMIT = 3000;
const ROOM_POINT_LIMIT = 200_000;
const STROKE_POINT_LIMIT = 8000;
const OPS_PER_REQUEST = 400;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const RATE_WINDOW = 1000;
const RATE_LIMIT = 60;
const COORD_LIMIT = 200_000;
const COLORS = 8;
const WIDTHS = [2, 4, 8, 14, 24];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.py': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8'
};

const SECURITY = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
};

function collectAssets(directory, prefix = '') {
  const found = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const route = prefix + '/' + entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of collectAssets(full, route)) found.set(key, value);
      continue;
    }
    const type = TYPES[path.extname(entry.name)];
    if (!type) continue;
    const body = fs.readFileSync(full);
    found.set(route, {
      type,
      body,
      gzip: zlib.gzipSync(body, { level: 9 }),
      etag: '"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"'
    });
  }
  return found;
}

const assets = collectAssets(PUBLIC);
assets.set('/', assets.get('/index.html'));

const rooms = new Map();
const rates = new Map();
const streams = new Map();

function roomOf(code) {
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= ROOM_LIMIT) evictIdleRoom();
    if (rooms.size >= ROOM_LIMIT) return null;
    room = { peers: new Map(), strokes: new Map(), points: 0, idleSince: Date.now() };
    rooms.set(code, room);
  }
  room.idleSince = Date.now();
  return room;
}

function validRoom(code) {
  return typeof code === 'string' && /^[a-z0-9-]{1,32}$/.test(code);
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,32}$/.test(value);
}

function validAnchor(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,32}$/.test(value);
}

function cleanName(value) {
  if (typeof value !== 'string') return 'Гость';
  const name = Array.from(value)
    .filter(char => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 24);
  return name || 'Гость';
}

function cleanColor(value) {
  const color = Number(value);
  return Number.isInteger(color) && color >= 0 && color < COLORS ? color : 0;
}

function addressOf(req) {
  const socket = req.socket.remoteAddress || 'unknown';
  const loopback = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'];
  if (loopback && typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return socket;
}

function allowed(key) {
  const now = Date.now();
  const hits = (rates.get(key) || []).filter(time => now - time < RATE_WINDOW);
  const ok = hits.length < RATE_LIMIT;
  if (ok) hits.push(now);
  rates.set(key, hits);
  return ok;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(JSON.stringify(payload));
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function peersOf(room, cursors) {
  return Array.from(room.peers.values(), peer => ({
    cid: peer.cid,
    name: peer.name,
    color: peer.color,
    ...(cursors && peer.cursor ? { cursor: peer.cursor } : {})
  }));
}

function broadcast(room, event, data, except) {
  for (const peer of room.peers.values()) {
    if (peer.cid === except) continue;
    for (const res of peer.streams) {
      try {
        send(res, event, data);
      } catch {
        peer.streams.delete(res);
      }
    }
  }
}

function snapshot(room) {
  return Array.from(room.strokes.values(), stroke => ({
    id: stroke.id, a: stroke.a, c: stroke.c, w: stroke.w, p: stroke.p, by: stroke.by
  }));
}

function openStream(req, res, url) {
  const code = url.searchParams.get('room') || 'main';
  const cid = url.searchParams.get('cid');
  if (!validRoom(code) || !validId(cid)) {
    json(res, 400, { error: 'неверная комната' });
    return;
  }
  const address = addressOf(req);
  const open = streams.get(address) || 0;
  if (open >= STREAMS_PER_ADDRESS || !allowed(address)) {
    json(res, 429, { error: 'слишком много вкладок' });
    return;
  }
  const room = roomOf(code);
  if (!room) {
    json(res, 503, { error: 'все комнаты заняты' });
    return;
  }
  let peer = room.peers.get(cid);
  if (!peer && room.peers.size >= PEER_LIMIT) {
    json(res, 503, { error: 'комната заполнена' });
    return;
  }
  if (!peer) {
    peer = { cid, name: 'Гость', color: 0, streams: new Set() };
    room.peers.set(cid, peer);
  }
  peer.name = cleanName(url.searchParams.get('name'));
  peer.color = cleanColor(url.searchParams.get('color'));
  streams.set(address, open + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...SECURITY
  });
  res.write('retry: 2000\n\n');
  peer.streams.add(res);
  send(res, 'hello', { you: cid, room: code, peers: peersOf(room, true), strokes: snapshot(room) });
  broadcast(room, 'presence', { peers: peersOf(room) }, cid);

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(beat);
    }
  }, 20_000);

  req.on('close', () => {
    clearInterval(beat);
    peer.streams.delete(res);
    const left = (streams.get(address) || 1) - 1;
    if (left > 0) streams.set(address, left);
    else streams.delete(address);
    if (!peer.streams.size) {
      room.peers.delete(cid);
      broadcast(room, 'ops', { from: cid, ops: [{ t: 'l' }] });
    }
    room.idleSince = Date.now();
    broadcast(room, 'presence', { peers: peersOf(room) });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function coordinates(raw, room, stroke) {
  if (!Array.isArray(raw) || raw.length % 2) return null;
  const roomLeft = ROOM_POINT_LIMIT - room.points;
  const strokeLeft = STROKE_POINT_LIMIT - (stroke ? stroke.p.length : 0);
  const count = Math.max(0, Math.min(raw.length, roomLeft, strokeLeft)) & ~1;
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    const value = Math.round(Number(raw[i]));
    if (!Number.isFinite(value)) return null;
    points[i] = Math.max(0, Math.min(COORD_LIMIT, value));
  }
  return points;
}

function apply(room, peer, op) {
  if (!op || typeof op !== 'object') return null;
  switch (op.t) {
    case 'b': {
      if (!validId(op.id) || !validAnchor(op.a)) return null;
      const width = WIDTHS.includes(op.w) ? op.w : WIDTHS[1];
      const laser = op.k === 'laser';
      const points = coordinates(op.p || [], room, null);
      if (!points) return null;
      if (!laser) {
        if (room.strokes.has(op.id) || room.strokes.size >= STROKE_LIMIT) return null;
        room.strokes.set(op.id, { id: op.id, a: op.a, c: cleanColor(op.c), w: width, p: points.slice(), by: peer.cid });
        room.points += points.length;
      }
      return { t: 'b', id: op.id, a: op.a, c: cleanColor(op.c), w: width, k: laser ? 'laser' : 'pen', p: points };
    }
    case 'p': {
      if (!validId(op.id)) return null;
      const stroke = room.strokes.get(op.id);
      if (stroke && stroke.by !== peer.cid) return null;
      const points = coordinates(op.p, room, stroke);
      if (!points || !points.length) return null;
      if (stroke) {
        for (const value of points) stroke.p.push(value);
        room.points += points.length;
      }
      return { t: 'p', id: op.id, p: points };
    }
    case 'e':
      return validId(op.id) ? { t: 'e', id: op.id } : null;
    case 'x': {
      if (!Array.isArray(op.ids)) return null;
      const removed = [];
      for (const id of op.ids.slice(0, 200)) {
        const stroke = room.strokes.get(id);
        if (!stroke) continue;
        room.strokes.delete(id);
        room.points -= stroke.p.length;
        removed.push(id);
      }
      return removed.length ? { t: 'x', ids: removed } : null;
    }
    case 'c': {
      const everything = op.a === '*';
      if (!everything && !validAnchor(op.a)) return null;
      for (const [id, stroke] of room.strokes) {
        if (everything || stroke.a === op.a) {
          room.strokes.delete(id);
          room.points -= stroke.p.length;
        }
      }
      return { t: 'c', a: op.a };
    }
    case 'm': {
      if (!validAnchor(op.a)) return null;
      const x = Math.round(Number(op.x));
      const y = Math.round(Number(op.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      peer.cursor = { a: op.a, x: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, x)), y: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, y)) };
      return { t: 'm', ...peer.cursor };
    }
    case 'l':
      return { t: 'l' };
    case 'n':
      peer.name = cleanName(op.name);
      peer.color = cleanColor(op.c);
      return { t: 'n', name: peer.name, c: peer.color };
    default:
      return null;
  }
}

async function handleOps(req, res, url) {
  const code = url.searchParams.get('room') || 'main';
  const cid = url.searchParams.get('cid');
  if (req.method !== 'POST' || !validRoom(code) || !validId(cid)) {
    json(res, 400, { error: 'плохой запрос' });
    return;
  }
  if (!allowed(cid) || !allowed(addressOf(req))) {
    json(res, 429, { error: 'слишком часто' });
    return;
  }
  const room = rooms.get(code);
  const peer = room && room.peers.get(cid);
  if (!peer) {
    json(res, 409, { error: 'нет подключения к комнате' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: 'плохой запрос' });
    return;
  }
  if (!Array.isArray(payload)) {
    json(res, 400, { error: 'плохой запрос' });
    return;
  }
  const accepted = [];
  let presence = false;
  for (const op of payload.slice(0, OPS_PER_REQUEST)) {
    const result = apply(room, peer, op);
    if (!result) continue;
    if (result.t === 'n') presence = true;
    else accepted.push(result);
  }
  room.idleSince = Date.now();
  if (accepted.length) broadcast(room, 'ops', { from: cid, ops: accepted }, cid);
  if (presence) broadcast(room, 'presence', { peers: peersOf(room) });
  json(res, 200, { ok: true, full: room.points >= ROOM_POINT_LIMIT || room.strokes.size >= STROKE_LIMIT });
}

function serveAsset(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
    res.end('метод не поддерживается');
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
    res.end('не найдено');
    return;
  }
  const headers = { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', ETag: asset.etag, Vary: 'Accept-Encoding', ...SECURITY };
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gzip ? asset.gzip : asset.body;
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('ok');
    } else if (url.pathname === '/api/stream') {
      openStream(req, res, url);
    } else if (url.pathname === '/api/ops') {
      await handleOps(req, res, url);
    } else {
      serveAsset(req, res, url);
    }
  } catch {
    if (!res.headersSent) json(res, 500, { error: 'внутренняя ошибка' });
    else res.end();
  }
});

function evictIdleRoom() {
  let victim = null;
  for (const [code, room] of rooms) {
    if (room.peers.size || code === 'main') continue;
    const worse = !victim
      || room.strokes.size < rooms.get(victim).strokes.size
      || (room.strokes.size === rooms.get(victim).strokes.size && room.idleSince < rooms.get(victim).idleSince);
    if (worse) victim = code;
  }
  if (victim) rooms.delete(victim);
}

function prune() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.peers.size && now - room.idleSince > ROOM_TTL) rooms.delete(code);
  }
  for (const [key, hits] of rates) {
    if (!hits.some(time => now - time < RATE_WINDOW)) rates.delete(key);
  }
}

setInterval(prune, 60_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`guarantees: http://${HOST}:${PORT}`);
});
