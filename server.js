'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash, randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT) || 8094;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

const BODY_LIMIT = 64 * 1024;
const BACKLOG_LIMIT = 256 * 1024;
const ROOM_LIMIT = 32;
const PEER_LIMIT = 40;
const STREAMS_PER_ADDRESS = 40;
const STROKE_LIMIT = 3000;
const ROOM_POINT_LIMIT = 200_000;
const STROKE_POINT_LIMIT = 8000;
const LASER_LIMIT = 4;
const LASER_POINT_LIMIT = 4000;
const OPS_PER_REQUEST = 400;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const OPEN_WINDOW = 10_000;
const OPEN_LIMIT = 40;
const OPS_WINDOW = 1000;
const PEER_OPS_LIMIT = 40;
const ADDRESS_OPS_LIMIT = 400;
const RATE_KEYS_LIMIT = 20_000;
const COORD_LIMIT = 200_000;
const COLORS = 8;
const LABS = new Set(['naive', 'amo', 'alo', 'eo', 'eoo']);
const LAB_MODES = new Set(['play', 'pause', 'step', 'reset']);
const SCENARIOS = new Set(['story', 'ideal', 'chaos']);
const PRESETS = new Set(['trap', 'fair', 'swap']);
const WIDTHS = [2, 4, 8, 14, 24];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.py': 'text/plain; charset=utf-8',
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
const streams = new Map();
const opens = new Map();
const addressOps = new Map();
const peerOps = new Map();

function roomOf(code) {
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= ROOM_LIMIT) evictIdleRoom();
    if (rooms.size >= ROOM_LIMIT) return null;
    room = { peers: new Map(), strokes: new Map(), points: 0, cache: null, labs: {}, checker: null, idleSince: Date.now() };
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

function network(address) {
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (!plain.includes(':')) return plain;
  const [head, tail = ''] = plain.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).join(':') + '::/64';
}

function addressOf(req) {
  const socket = req.socket.remoteAddress || 'unknown';
  const loopback = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'];
  if (loopback && typeof forwarded === 'string' && forwarded.trim()) return network(forwarded.split(',').pop().trim());
  return network(socket);
}

function hit(counters, key, window, limit) {
  const now = Date.now();
  let entry = counters.get(key);
  if (!entry || now - entry.start >= window) {
    if (!entry && counters.size >= RATE_KEYS_LIMIT) {
      for (const [name, value] of counters) {
        if (now - value.start >= window) counters.delete(name);
      }
      if (counters.size >= RATE_KEYS_LIMIT) counters.clear();
    }
    entry = { start: now, count: 0 };
    counters.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= limit;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(JSON.stringify(payload));
}

function chunkOf(event, data) {
  return `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function deliver(res, chunk) {
  if (res.destroyed) return;
  if (res.writableLength > BACKLOG_LIMIT) {
    res.destroy();
    return;
  }
  res.write(chunk);
}

function peersOf(room, cursors) {
  return Array.from(room.peers.values(), peer => ({
    id: peer.id,
    name: peer.name,
    color: peer.color,
    ...(cursors && peer.cursor ? { cursor: peer.cursor } : {})
  }));
}

function broadcast(room, event, data, except) {
  const chunk = chunkOf(event, data);
  for (const peer of room.peers.values()) {
    if (peer.id === except) continue;
    for (const res of peer.streams) deliver(res, chunk);
  }
}

function strokesJson(room) {
  if (room.cache === null) {
    room.cache = JSON.stringify(Array.from(room.strokes.values(), stroke => ({
      id: stroke.id, a: stroke.a, c: stroke.c, w: stroke.w, p: stroke.p
    })));
  }
  return room.cache;
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
  if (open >= STREAMS_PER_ADDRESS || !hit(opens, address, OPEN_WINDOW, OPEN_LIMIT)) {
    json(res, 429, { error: 'слишком много подключений' });
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
    peer = { cid, id: randomBytes(9).toString('base64url'), name: 'Гость', color: 0, streams: new Set(), lasers: new Map(), cursor: null };
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
  const head = JSON.stringify({ you: peer.id, room: code, peers: peersOf(room, true), labs: room.labs, checker: room.checker, now: Date.now() });
  deliver(res, chunkOf('hello', head.slice(0, -1) + ',"strokes":' + strokesJson(room) + '}'));
  broadcast(room, 'presence', { peers: peersOf(room) }, peer.id);

  const beat = setInterval(() => deliver(res, ': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(beat);
    peer.streams.delete(res);
    const left = (streams.get(address) || 1) - 1;
    if (left > 0) streams.set(address, left);
    else streams.delete(address);
    if (!peer.streams.size && room.peers.get(cid) === peer) {
      room.peers.delete(cid);
      broadcast(room, 'ops', { from: peer.id, ops: [{ t: 'l' }] });
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

function coordinates(raw, budget) {
  if (!Array.isArray(raw) || raw.length % 2) return null;
  const count = Math.max(0, Math.min(raw.length, budget)) & ~1;
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    const value = Math.round(Number(raw[i]));
    if (!Number.isFinite(value)) return null;
    points[i] = Math.max(0, Math.min(COORD_LIMIT, value));
  }
  return points;
}

function knownLaser(room, id) {
  for (const peer of room.peers.values()) {
    if (peer.lasers.has(id)) return true;
  }
  return false;
}

function apply(room, peer, op) {
  if (!op || typeof op !== 'object') return null;
  switch (op.t) {
    case 'b': {
      if (!validId(op.id) || !validAnchor(op.a) || room.strokes.has(op.id) || knownLaser(room, op.id)) return null;
      const width = WIDTHS.includes(op.w) ? op.w : WIDTHS[1];
      const color = cleanColor(op.c);
      if (op.k === 'laser') {
        if (peer.lasers.size >= LASER_LIMIT) return null;
        const points = coordinates(op.p || [], LASER_POINT_LIMIT);
        if (!points || !points.length) return null;
        peer.lasers.set(op.id, points.length);
        return { t: 'b', id: op.id, a: op.a, c: color, w: width, k: 'laser', p: points };
      }
      if (room.strokes.size >= STROKE_LIMIT) return null;
      const points = coordinates(op.p || [], Math.min(STROKE_POINT_LIMIT, ROOM_POINT_LIMIT - room.points));
      if (!points || !points.length) return null;
      room.strokes.set(op.id, { id: op.id, a: op.a, c: color, w: width, p: points.slice(), by: peer.cid });
      room.points += points.length;
      room.cache = null;
      return { t: 'b', id: op.id, a: op.a, c: color, w: width, k: 'pen', p: points };
    }
    case 'p': {
      if (!validId(op.id)) return null;
      const stroke = room.strokes.get(op.id);
      if (stroke) {
        if (stroke.by !== peer.cid) return null;
        const points = coordinates(op.p, Math.min(STROKE_POINT_LIMIT - stroke.p.length, ROOM_POINT_LIMIT - room.points));
        if (!points || !points.length) return null;
        for (const value of points) stroke.p.push(value);
        room.points += points.length;
        room.cache = null;
        return { t: 'p', id: op.id, p: points };
      }
      const used = peer.lasers.get(op.id);
      if (used === undefined) return null;
      const points = coordinates(op.p, LASER_POINT_LIMIT - used);
      if (!points || !points.length) return null;
      peer.lasers.set(op.id, used + points.length);
      return { t: 'p', id: op.id, p: points };
    }
    case 'e': {
      if (!validId(op.id)) return null;
      if (peer.lasers.delete(op.id)) return { t: 'e', id: op.id };
      const stroke = room.strokes.get(op.id);
      return stroke && stroke.by === peer.cid ? { t: 'e', id: op.id } : null;
    }
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
      if (!removed.length) return null;
      room.cache = null;
      return { t: 'x', ids: removed };
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
      room.cache = null;
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
      peer.cursor = null;
      return { t: 'l' };
    case 'lab': {
      const at = Number(op.at);
      if (!LABS.has(op.lab) || !LAB_MODES.has(op.mode) || !SCENARIOS.has(op.scenario)) return null;
      if (!Number.isInteger(op.seed) || op.seed < 0 || op.seed >= 2 ** 31 || !Number.isFinite(at) || at < 0 || at > 1000) return null;
      const speed = op.speed === undefined ? 1 : Number(op.speed);
      if (!Number.isFinite(speed) || speed < 0 || speed > 1) return null;
      const state = { t: 'lab', lab: op.lab, mode: op.mode, scenario: op.scenario, seed: op.seed, at, speed: Math.round(speed * 100) / 100 };
      room.labs[op.lab] = { ...state, stamp: Date.now() };
      return state;
    }
    case 'checker': {
      if (!PRESETS.has(op.preset) || !['run', 'pause'].includes(op.mode) || !Number.isInteger(op.steps) || op.steps < 0 || op.steps > 50) return null;
      const state = { t: 'checker', preset: op.preset, steps: op.steps, mode: op.mode };
      room.checker = { ...state, stamp: Date.now() };
      return state;
    }
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
  if (!hit(addressOps, addressOf(req), OPS_WINDOW, ADDRESS_OPS_LIMIT)) {
    json(res, 429, { error: 'слишком часто' });
    return;
  }
  const room = rooms.get(code);
  const peer = room && room.peers.get(cid);
  if (!peer) {
    json(res, 409, { error: 'нет подключения к комнате' });
    return;
  }
  if (!hit(peerOps, cid, OPS_WINDOW, PEER_OPS_LIMIT)) {
    json(res, 429, { error: 'слишком часто' });
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
  if (accepted.length) broadcast(room, 'ops', { from: peer.id, ops: accepted }, peer.id);
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
  try {
    const url = new URL(req.url, 'http://local');
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
    if (!res.headersSent) json(res, 400, { error: 'плохой запрос' });
    else res.end();
  }
});

function evictIdleRoom() {
  let victim = null;
  for (const [code, room] of rooms) {
    if (room.peers.size || code === 'main') continue;
    const current = victim && rooms.get(victim);
    if (!current || room.strokes.size < current.strokes.size
      || (room.strokes.size === current.strokes.size && room.idleSince < current.idleSince)) victim = code;
  }
  if (victim) rooms.delete(victim);
}

function prune() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.peers.size && now - room.idleSince > ROOM_TTL) rooms.delete(code);
  }
  for (const [counters, window] of [[opens, OPEN_WINDOW], [addressOps, OPS_WINDOW], [peerOps, OPS_WINDOW]]) {
    for (const [key, entry] of counters) {
      if (now - entry.start >= window) counters.delete(key);
    }
  }
}

setInterval(prune, 60_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`guarantees: http://${HOST}:${PORT}`);
});
