'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash, randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT) || 8094;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const CHAT_CLIENTS = (process.env.MESSENGER_CLIENTS || '').split(',').map(value => value.trim()).filter(Boolean);

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
const LAB_MODES = new Set(['play', 'pause', 'step', 'reset']);
const WIDTHS = [2, 4, 8, 14, 24];
const CHAT_CLIENT_COUNT = 2;
const CHAT_LOG_LIMIT = 40;
const CHAT_TEXT_LIMIT = 200;
const CHAT_AUTHOR_LIMIT = 40;
const CHAT_RESPONSE_LIMIT = 1024 * 1024;
const CHAT_POLL_MS = 900;
const CHAT_SLOW_MS = 4000;
const CHAT_DEADLINE_MS = 120_000;
const CHAT_QUEUE_LIMIT = 4;
const CHAT_PEER_WINDOW = 1000;
const CHAT_PEER_LIMIT = 2;
const CHAT_WINDOW = 60_000;
const CHAT_ADDRESS_LIMIT = 30;
const CHAT_GLOBAL_WINDOW = 1000;
const CHAT_GLOBAL_LIMIT = 8;
const BURST_WINDOW = 6000;
const BURST_TEXTS = [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3']];

if (CHAT_CLIENTS.length && (CHAT_CLIENTS.length !== CHAT_CLIENT_COUNT || !CHAT_CLIENTS.every(value => /^[A-Za-z0-9.-]+:\d{1,5}$/.test(value)))) {
  throw new Error('MESSENGER_CLIENTS: нужны два адреса host:port через запятую');
}

const SITES = new Map([
  ['guarantees', {
    labs: new Set(['naive', 'amo', 'alo', 'eo', 'eoo']),
    scenarios: new Set(['story', 'ideal', 'chaos']),
    presets: new Set(['trap', 'fair', 'swap']),
    chat: false
  }],
  ['messenger', {
    labs: new Set(['send', 'subscribe', 'flush', 'reconnect']),
    scenarios: new Set(['ok', 'nolock', 'outside', 'noretry']),
    presets: new Set(),
    chat: true
  }]
]);
const DEFAULT_SITE = 'guarantees';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.py': 'text/plain; charset=utf-8',
  '.proto': 'text/plain; charset=utf-8',
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

const shared = collectAssets(path.join(PUBLIC, 'shared'));
const assets = new Map(Array.from(SITES.keys(), site => {
  const own = collectAssets(path.join(PUBLIC, site));
  own.set('/', own.get('/index.html'));
  return [site, new Map([...shared, ...own])];
}));

const rooms = new Map();
const streams = new Map();
const opens = new Map();
const addressOps = new Map();
const peerOps = new Map();
const chatPeers = new Map();
const chatAddresses = new Map();
const chatGlobal = new Map();
const chatBursts = new Map();
const chat = {
  clients: CHAT_CLIENTS.map(address => {
    const [host, port] = address.split(':');
    return { host, port: Number(port), log: [], online: false, queue: Promise.resolve(), waiting: 0, polling: false, again: false };
  }),
  stamps: []
};

function siteOf(req) {
  const label = String(req.headers.host || '').toLowerCase().split(':')[0].split('.')[0];
  return SITES.has(label) ? label : DEFAULT_SITE;
}

function roomKey(site, code) {
  return site + '/' + code;
}

function roomOf(site, code) {
  const key = roomKey(site, code);
  let room = rooms.get(key);
  if (!room) {
    const limited = code !== 'main';
    if (limited && rooms.size >= ROOM_LIMIT) evictIdleRoom();
    if (limited && rooms.size >= ROOM_LIMIT) return null;
    room = { site, code, peers: new Map(), strokes: new Map(), points: 0, cache: null, labs: {}, checker: null, seq: 0, idleSince: Date.now() };
    rooms.set(key, room);
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

function clip(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = Array.from(value)
    .filter(char => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127)
    .join('')
    .trim();
  return Array.from(clean).slice(0, limit).join('').toWellFormed();
}

function cleanName(value) {
  return clip(value, 24) || 'Аноним';
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

function hit(counters, key, window, limit, amount = 1) {
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
  entry.count += amount;
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

function openStream(req, res, url, site) {
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
  const room = roomOf(site, code);
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
    peer = { cid, id: randomBytes(9).toString('base64url'), name: 'Аноним', color: 0, streams: new Set(), lasers: new Map(), cursor: null };
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
  const hello = { you: peer.id, room: code, peers: peersOf(room, true), labs: room.labs, checker: room.checker, now: Date.now() };
  if (SITES.get(site).chat) hello.chat = chatSnapshot();
  const head = JSON.stringify(hello);
  deliver(res, chunkOf('hello', head.slice(0, -1) + ',"strokes":' + strokesJson(room) + '}'));
  broadcast(room, 'presence', { peers: peersOf(room) }, peer.id);
  if (SITES.get(site).chat) pollChat();

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
      const settings = SITES.get(room.site);
      if (!settings.labs.has(op.lab) || !LAB_MODES.has(op.mode) || !settings.scenarios.has(op.scenario)) return null;
      if (!Number.isInteger(op.seed) || op.seed < 0 || op.seed >= 2 ** 31 || !Number.isFinite(at) || at < 0 || at > 1000) return null;
      const speed = op.speed === undefined ? 1 : Number(op.speed);
      if (!Number.isFinite(speed) || speed < 0 || speed > 1) return null;
      const state = { t: 'lab', lab: op.lab, mode: op.mode, scenario: op.scenario, seed: op.seed, at, speed: Math.round(speed * 100) / 100, seq: ++room.seq };
      room.labs[op.lab] = { ...state, stamp: Date.now() };
      return state;
    }
    case 'checker': {
      if (!SITES.get(room.site).presets.has(op.preset) || !['run', 'pause'].includes(op.mode) || !Number.isInteger(op.steps) || op.steps < 0 || op.steps > 50) return null;
      const state = { t: 'checker', preset: op.preset, steps: op.steps, mode: op.mode, seq: ++room.seq };
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

async function handleOps(req, res, url, site) {
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
  const room = rooms.get(roomKey(site, code));
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
  const ordered = [];
  let presence = false;
  for (const op of payload.slice(0, OPS_PER_REQUEST)) {
    const result = apply(room, peer, op);
    if (!result) continue;
    if (result.t === 'n') presence = true;
    else if (result.seq) ordered.push(result);
    else accepted.push(result);
  }
  room.idleSince = Date.now();
  if (accepted.length) broadcast(room, 'ops', { from: peer.id, ops: accepted }, peer.id);
  if (ordered.length) broadcast(room, 'ops', { from: peer.id, ops: ordered });
  if (presence) broadcast(room, 'presence', { peers: peersOf(room) });
  json(res, 200, { ok: true, full: room.points >= ROOM_POINT_LIMIT || room.strokes.size >= STROKE_LIMIT });
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/.test(value) ? value : '';
}

function chatMessage(raw) {
  const message = raw && typeof raw === 'object' ? raw : {};
  return { author: clip(message.author, CHAT_AUTHOR_LIMIT), text: clip(message.text, CHAT_TEXT_LIMIT), sendTime: timestamp(message.sendTime) };
}

function chatSnapshot() {
  return {
    ports: chat.clients.map(client => client.port),
    online: chat.clients.map(client => client.online),
    logs: chat.clients.map(client => client.log),
    stamps: chat.stamps
  };
}

function chatBroadcast(data) {
  for (const room of rooms.values()) {
    if (SITES.get(room.site).chat) broadcast(room, 'chat', data);
  }
}

function chatWatched() {
  for (const room of rooms.values()) {
    if (SITES.get(room.site).chat && room.peers.size) return true;
  }
  return false;
}

function clientCall(client, route, body = '') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: client.host,
      port: client.port,
      path: route,
      method: 'POST',
      agent: false,
      timeout: CHAT_DEADLINE_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > CHAT_RESPONSE_LIMIT) request.destroy(new Error('too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error('status ' + response.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

function markOnline(client, online) {
  if (client.online === online) return;
  client.online = online;
  chatBroadcast({ t: 'status', online: chat.clients.map(item => item.online) });
}

function clientRequest(client, route, body) {
  if (client.waiting >= CHAT_QUEUE_LIMIT) return Promise.reject(new Error('busy'));
  client.waiting += 1;
  const result = client.queue.then(() => {
    const slow = setTimeout(() => markOnline(client, false), CHAT_SLOW_MS);
    return clientCall(client, route, body).finally(() => clearTimeout(slow));
  });
  client.queue = result
    .then(() => markOnline(client, true), () => markOnline(client, false))
    .finally(() => {
      client.waiting -= 1;
    });
  return result;
}

function pollClient(client, index) {
  if (client.polling) {
    client.again = true;
    return;
  }
  client.polling = true;
  clientRequest(client, '/getAndFlushMessages')
    .then(answer => {
      if (!Array.isArray(answer) || !answer.length) return;
      const messages = answer.slice(-CHAT_LOG_LIMIT).map(chatMessage);
      client.log = client.log.concat(messages).slice(-CHAT_LOG_LIMIT);
      chatBroadcast({ t: 'got', c: index, m: messages });
    }, () => {})
    .finally(() => {
      client.polling = false;
      if (client.again) {
        client.again = false;
        pollClient(client, index);
      }
    });
}

function pollChat() {
  chat.clients.forEach(pollClient);
}

async function sendChat(index, author, text) {
  const answer = await clientRequest(chat.clients[index], '/sendMessage', asciiJson({ author, text }));
  const stamp = { c: index, author, text, sendTime: timestamp(answer && answer.sendTime) };
  chat.stamps = chat.stamps.concat(stamp).slice(-CHAT_LOG_LIMIT);
  chatBroadcast({ t: 'sent', ...stamp });
  return stamp;
}

async function handleChat(req, res, url, site) {
  const code = url.searchParams.get('room') || 'main';
  const cid = url.searchParams.get('cid');
  if (req.method !== 'POST' || !SITES.get(site).chat || !validRoom(code) || !validId(cid)) {
    json(res, 400, { error: 'плохой запрос' });
    return;
  }
  if (!chat.clients.length) {
    json(res, 503, { error: 'чат выключен' });
    return;
  }
  const room = rooms.get(roomKey(site, code));
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
  const burst = Boolean(payload && payload.burst === true);
  const index = Number(payload && payload.c);
  const text = clip(payload && payload.text, CHAT_TEXT_LIMIT);
  if (!burst && (!Number.isInteger(index) || !chat.clients[index] || !text)) {
    json(res, 400, { error: 'пустое сообщение' });
    return;
  }
  if ((burst ? chat.clients : [chat.clients[index]]).some(client => !client.online)) {
    json(res, 503, { error: 'клиент мессенджера не отвечает' });
    return;
  }
  const count = burst ? BURST_TEXTS.flat().length : 1;
  if ((burst && !hit(chatBursts, 'burst', BURST_WINDOW, 1)) || !hit(chatPeers, cid, CHAT_PEER_WINDOW, CHAT_PEER_LIMIT)
    || !hit(chatAddresses, addressOf(req), CHAT_WINDOW, CHAT_ADDRESS_LIMIT, count) || !hit(chatGlobal, 'send', CHAT_GLOBAL_WINDOW, CHAT_GLOBAL_LIMIT, count)) {
    json(res, 429, { error: 'слишком часто' });
    return;
  }
  const work = burst
    ? Promise.all(BURST_TEXTS.flatMap((texts, client) => texts.map(value => sendChat(client, peer.name, value))))
    : sendChat(index, peer.name, text);
  const outcome = await Promise.race([
    work.then(() => 'sent', () => 'failed'),
    new Promise(resolve => setTimeout(resolve, CHAT_SLOW_MS, 'slow'))
  ]);
  if (outcome === 'sent') json(res, 200, { ok: true });
  else if (outcome === 'slow') json(res, 504, { error: 'клиент мессенджера медлит: сообщение уйдёт, когда он ответит' });
  else json(res, 502, { error: 'клиент мессенджера не ответил' });
  setTimeout(pollChat, 60);
  setTimeout(pollChat, 400);
}

function serveAsset(req, res, url, site) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
    res.end('метод не поддерживается');
    return;
  }
  const asset = assets.get(site).get(url.pathname);
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
    const site = siteOf(req);
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('ok');
    } else if (url.pathname === '/api/stream') {
      openStream(req, res, url, site);
    } else if (url.pathname === '/api/ops') {
      await handleOps(req, res, url, site);
    } else if (url.pathname === '/api/chat') {
      await handleChat(req, res, url, site);
    } else {
      serveAsset(req, res, url, site);
    }
  } catch {
    if (!res.headersSent) json(res, 400, { error: 'плохой запрос' });
    else res.end();
  }
});

function evictIdleRoom() {
  let victim = null;
  for (const [key, room] of rooms) {
    if (room.peers.size || room.code === 'main') continue;
    const current = victim && rooms.get(victim);
    if (!current || room.strokes.size < current.strokes.size
      || (room.strokes.size === current.strokes.size && room.idleSince < current.idleSince)) victim = key;
  }
  if (victim) rooms.delete(victim);
}

function prune() {
  const now = Date.now();
  for (const [key, room] of rooms) {
    if (!room.peers.size && now - room.idleSince > ROOM_TTL) rooms.delete(key);
  }
  const windows = [[opens, OPEN_WINDOW], [addressOps, OPS_WINDOW], [peerOps, OPS_WINDOW], [chatPeers, CHAT_PEER_WINDOW], [chatAddresses, CHAT_WINDOW], [chatGlobal, CHAT_GLOBAL_WINDOW], [chatBursts, BURST_WINDOW]];
  for (const [counters, window] of windows) {
    for (const [key, entry] of counters) {
      if (now - entry.start >= window) counters.delete(key);
    }
  }
}

setInterval(prune, 60_000).unref();
setInterval(() => {
  if (chat.clients.length && chatWatched()) pollChat();
}, CHAT_POLL_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`distsys: http://${HOST}:${PORT}`);
});
