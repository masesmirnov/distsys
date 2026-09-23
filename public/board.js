const PALETTE = ['var(--ink)', '#3987e5', '#eb6834', '#1baf7a', '#e87ba4', '#9085e9', '#e34948', '#eda100'];
const PEN_WIDTHS = [2, 4, 8];
const LASER_WIDTH = 8;
const SCALE = 10000;
const FLUSH_MS = 50;
const CURSOR_MS = 40;
const ERASE_PX = 14;

const $ = selector => document.querySelector(selector);

function randomId(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function stored(storage, key, create) {
  try {
    let value = storage.getItem(key);
    if (!value) {
      value = create();
      storage.setItem(key, value);
    }
    return value;
  } catch {
    return create();
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function pathData(points) {
  if (points.length < 4) return `M${points[0]} ${points[1]}l0.1 0`;
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const x = (points[i] + points[i + 2]) / 2;
    const y = (points[i + 1] + points[i + 3]) / 2;
    d += `Q${points[i]} ${points[i + 1]} ${x} ${y}`;
  }
  return d + `L${points[points.length - 2]} ${points[points.length - 1]}`;
}

function initials(name) {
  const letters = name.trim().split(/\s+/).map(part => Array.from(part)[0] || '').join('');
  return (letters || '?').slice(0, 2).toUpperCase();
}

class Board {
  constructor() {
    const params = new URLSearchParams(location.search);
    const room = (params.get('room') || 'main').toLowerCase();
    this.room = /^[a-z0-9-]{1,32}$/.test(room) ? room : 'main';
    this.cid = stored(sessionStorage, 'board-cid', () => randomId(16));
    this.name = stored(localStorage, 'board-name', () => 'Гость ' + (10 + Math.floor(Math.random() * 90)));
    this.color = Number(stored(localStorage, 'board-color', () => String(1 + Math.floor(Math.random() * 7))));
    this.penColor = Number(stored(localStorage, 'board-pen', () => '0'));
    this.penWidth = Number(stored(localStorage, 'board-width', () => '4'));
    this.tool = 'pen';
    this.drawing = false;
    this.surfaces = new Map();
    this.strokes = new Map();
    this.mine = [];
    this.peers = [];
    this.cursors = new Map();
    this.queue = [];
    this.flushTimer = 0;
    this.lastCursor = 0;
    this.cursorTimer = 0;
    this.pointer = null;
    this.sharedCursor = null;
    this.sending = false;
    this.online = false;
    this.me = null;
    this.backoff = 0;
    this.reconnectTimer = 0;
    this.active = null;
    this.fullWarned = false;
    this.counter = 0;
    this.collectSurfaces();
    this.buildDock();
    this.bindKeys();
    this.renderRoomLine();
    this.connect();
  }

  collectSurfaces() {
    for (const holder of document.querySelectorAll('[data-anchor], [data-cursor]')) {
      const board = holder.classList.contains('board');
      const surface = board ? holder : holder.querySelector(':scope > .wrap') || holder;
      if (getComputedStyle(surface).position === 'static') surface.style.position = 'relative';
      const entry = { anchor: holder.dataset.anchor || holder.dataset.cursor, holder, surface, svg: null, board, width: 1, height: 1 };
      if (holder.dataset.anchor) {
        entry.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        entry.svg.classList.add('ink');
        entry.svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
        surface.append(entry.svg);
        entry.svg.addEventListener('pointerdown', event => this.pointerDown(event, entry));
        surface.addEventListener('pointermove', event => this.pointerMove(event, entry));
      }
      this.surfaces.set(entry.anchor, entry);
      this.resize(entry);
    }
    document.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      this.pointer = { clientX: event.clientX, clientY: event.clientY };
      this.shareCursor();
    }, { passive: true });
    window.addEventListener('scroll', () => this.shareCursor(), { passive: true });
    const observer = new ResizeObserver(entries => {
      for (const item of entries) {
        const entry = Array.from(this.surfaces.values()).find(value => value.surface === item.target);
        if (entry) this.resize(entry);
      }
    });
    for (const entry of this.surfaces.values()) observer.observe(entry.surface);
    window.addEventListener('pointerup', event => this.pointerUp(event));
    window.addEventListener('pointercancel', event => this.pointerUp(event));
  }

  resize(entry) {
    entry.width = Math.max(1, entry.surface.clientWidth);
    entry.height = Math.max(1, entry.surface.clientHeight);
    if (entry.svg) entry.svg.setAttribute('viewBox', `0 0 ${SCALE} ${Math.round(SCALE * entry.height / entry.width)}`);
    for (const cursor of this.cursors.values()) {
      if (cursor.anchor === entry.anchor) this.placeCursor(cursor);
    }
  }

  local(event, entry) {
    const box = entry.surface.getBoundingClientRect();
    const x = Math.round((event.clientX - box.left) / box.width * SCALE);
    const y = Math.round((event.clientY - box.top) / box.width * SCALE);
    return [Math.max(0, x), Math.max(0, y)];
  }

  enabled(entry) {
    return entry.board || this.drawing;
  }

  pointerDown(event, entry) {
    if (!this.enabled(entry) || event.button > 0) return;
    event.preventDefault();
    if (event.isTrusted) entry.svg.setPointerCapture(event.pointerId);
    const point = this.local(event, entry);
    if (this.tool === 'eraser') {
      this.active = { eraser: true, entry, pointer: event.pointerId };
      this.erase(entry, point);
      return;
    }
    const laser = this.tool === 'laser';
    const id = this.cid.slice(0, 6) + (this.counter++).toString(36) + randomId(4);
    const stroke = { id, a: entry.anchor, c: this.penColor, w: laser ? LASER_WIDTH : this.penWidth, k: laser ? 'laser' : 'pen', p: point.slice() };
    this.addStroke(stroke);
    this.active = { stroke, entry, sent: point.length, pointer: event.pointerId, last: point };
    this.send({ t: 'b', id, a: stroke.a, c: stroke.c, w: stroke.w, k: stroke.k, p: point });
    if (!laser) this.mine.push(id);
  }

  pointerMove(event, entry) {
    if (!this.active || this.active.pointer !== event.pointerId || this.active.entry !== entry) return;
    const point = this.local(event, entry);
    if (this.active.eraser) {
      this.erase(entry, point);
      return;
    }
    const [lx, ly] = this.active.last;
    if (Math.hypot(point[0] - lx, point[1] - ly) < SCALE / entry.width * 1.5) return;
    this.active.last = point;
    this.active.stroke.p.push(point[0], point[1]);
    this.renderStroke(this.active.stroke);
    this.touchLaser(this.active.stroke);
  }

  barBottom() {
    const bar = document.querySelector('.bar');
    return bar ? bar.getBoundingClientRect().bottom : 0;
  }

  surfaceAt(x, y) {
    if (y <= this.barBottom()) return null;
    let best = null;
    let area = Infinity;
    for (const entry of this.surfaces.values()) {
      const box = entry.holder.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      if (box.width * box.height < area) {
        best = entry;
        area = box.width * box.height;
      }
    }
    return best;
  }

  shareCursor() {
    if (!this.pointer) return;
    const wait = CURSOR_MS - (performance.now() - this.lastCursor);
    if (wait > 0) {
      if (!this.cursorTimer) {
        this.cursorTimer = setTimeout(() => {
          this.cursorTimer = 0;
          this.shareCursor();
        }, wait);
      }
      return;
    }
    this.lastCursor = performance.now();
    const entry = this.surfaceAt(this.pointer.clientX, this.pointer.clientY);
    if (!entry) return;
    const box = entry.surface.getBoundingClientRect();
    const x = Math.round((this.pointer.clientX - box.left) / box.width * SCALE);
    const y = Math.round((this.pointer.clientY - box.top) / box.width * SCALE);
    if (this.sharedCursor && this.sharedCursor.a === entry.anchor && this.sharedCursor.x === x && this.sharedCursor.y === y) return;
    this.sharedCursor = { a: entry.anchor, x, y };
    this.send({ t: 'm', a: entry.anchor, x, y });
  }

  pointerUp(event) {
    if (!this.active || this.active.pointer !== event.pointerId) return;
    const active = this.active;
    this.active = null;
    if (active.eraser) return;
    this.flushPoints(active);
    this.send({ t: 'e', id: active.stroke.id });
    active.stroke.done = true;
    this.touchLaser(active.stroke);
  }

  flushPoints(active) {
    const points = active.stroke.p;
    if (points.length > active.sent) {
      this.send({ t: 'p', id: active.stroke.id, p: points.slice(active.sent) });
      active.sent = points.length;
    }
  }

  erase(entry, [x, y]) {
    const radius = ERASE_PX / entry.width * SCALE;
    const hits = [];
    for (const stroke of this.strokes.values()) {
      if (stroke.a !== entry.anchor || stroke.k === 'laser') continue;
      const reach = radius + stroke.w * 5;
      for (let i = 0; i < stroke.p.length; i += 2) {
        if (Math.abs(stroke.p[i] - x) <= reach && Math.abs(stroke.p[i + 1] - y) <= reach) {
          hits.push(stroke.id);
          break;
        }
      }
    }
    if (!hits.length) return;
    hits.forEach(id => this.removeStroke(id));
    this.send({ t: 'x', ids: hits });
  }

  addStroke(stroke) {
    const entry = this.surfaces.get(stroke.a);
    if (!entry || !entry.svg) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (stroke.k === 'laser') path.classList.add('laser');
    const color = PALETTE[stroke.c] || PALETTE[0];
    path.style.stroke = color;
    path.style.color = color.startsWith('#') ? color : 'var(--accent)';
    path.setAttribute('stroke-width', String(stroke.w * 10));
    entry.svg.append(path);
    this.strokes.set(stroke.id, { ...stroke, path });
    this.renderStroke(this.strokes.get(stroke.id));
    if (entry.board && stroke.k !== 'laser') entry.surface.classList.add('inked');
  }

  renderStroke(stroke) {
    const known = this.strokes.get(stroke.id);
    if (!known) return;
    if (known !== stroke) known.p = stroke.p;
    known.path.setAttribute('d', pathData(known.p));
  }

  touchLaser(stroke) {
    const known = this.strokes.get(stroke.id);
    if (!known || known.k !== 'laser') return;
    clearTimeout(known.fade);
    clearTimeout(known.gone);
    known.path.classList.remove('fading');
    known.fade = setTimeout(() => {
      known.path.classList.add('fading');
      known.gone = setTimeout(() => this.removeStroke(known.id), 950);
    }, known.done ? 300 : 6000);
  }

  removeStroke(id) {
    const stroke = this.strokes.get(id);
    if (!stroke) return;
    clearTimeout(stroke.fade);
    clearTimeout(stroke.gone);
    stroke.path.remove();
    this.strokes.delete(id);
    this.refreshInked();
  }

  clearStrokes(anchor) {
    for (const stroke of Array.from(this.strokes.values())) {
      if (anchor === '*' || stroke.a === anchor) this.removeStroke(stroke.id);
    }
  }

  refreshInked() {
    for (const entry of this.surfaces.values()) {
      if (!entry.board) continue;
      const inked = Array.from(this.strokes.values()).some(stroke => stroke.a === entry.anchor && stroke.k !== 'laser');
      entry.surface.classList.toggle('inked', inked);
    }
  }

  send(op) {
    this.queue.push(op);
    if (this.queue.length > 2000) this.queue.splice(0, this.queue.length - 2000);
    this.schedule(FLUSH_MS);
  }

  schedule(delay) {
    if (!this.flushTimer && !this.sending) this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  async flush() {
    this.flushTimer = 0;
    if (this.active && !this.active.eraser) this.flushPoints(this.active);
    if (!this.queue.length || !this.online || this.sending) return;
    const ops = this.queue.splice(0, 400);
    this.sending = true;
    let retry = 0;
    try {
      const response = await fetch(`api/ops?room=${encodeURIComponent(this.room)}&cid=${this.cid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ops)
      });
      if (response.ok) {
        const answer = await response.json();
        if (answer.full && !this.fullWarned) {
          this.fullWarned = true;
          toast('Доска заполнена: сотрите что-нибудь, чтобы рисовать дальше');
        }
      } else if (response.status === 429 || response.status >= 500) {
        this.queue.unshift(...ops);
        retry = 400;
      } else if (response.status === 409) {
        this.connect();
      }
    } catch {
      this.queue.unshift(...ops);
      retry = 1500;
    }
    this.sending = false;
    if (this.queue.length) this.schedule(retry || FLUSH_MS);
  }

  connect() {
    if (this.source) this.source.close();
    clearTimeout(this.reconnectTimer);
    const query = new URLSearchParams({ room: this.room, cid: this.cid, name: this.name, color: String(this.color) });
    const source = new EventSource('api/stream?' + query);
    this.source = source;
    source.addEventListener('hello', event => this.hello(JSON.parse(event.data)));
    source.addEventListener('presence', event => this.presence(JSON.parse(event.data).peers));
    source.addEventListener('ops', event => this.remote(JSON.parse(event.data)));
    source.addEventListener('error', () => {
      this.setOnline(false);
      if (source !== this.source || source.readyState !== EventSource.CLOSED) return;
      this.backoff = Math.min(15000, (this.backoff || 1000) * 2);
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
    });
  }

  setOnline(online) {
    this.online = online;
    const dot = $('#status');
    dot.classList.toggle('online', online);
    dot.title = online ? 'Доска на связи' : 'Нет связи с доской, переподключаюсь';
  }

  hello(data) {
    this.me = data.you;
    this.backoff = 0;
    this.setOnline(true);
    for (const stroke of Array.from(this.strokes.values())) {
      if (stroke.k !== 'laser') this.removeStroke(stroke.id);
    }
    for (const stroke of data.strokes) this.addStroke({ ...stroke, k: 'pen', done: true });
    this.mine = this.mine.filter(id => this.strokes.has(id));
    this.presence(data.peers);
    for (const peer of data.peers) {
      if (peer.cursor && peer.id !== this.me) this.moveCursor(peer.id, peer.cursor);
    }
    if (this.queue.length) this.schedule(FLUSH_MS);
  }

  presence(peers) {
    this.peers = peers;
    const holder = $('#peers');
    holder.replaceChildren();
    const ordered = [...peers].sort((a, b) => (b.id === this.me) - (a.id === this.me));
    for (const peer of ordered.slice(0, 4)) {
      const node = document.createElement('span');
      node.className = 'peer' + (peer.id === this.me ? ' me' : '');
      node.style.background = PALETTE[peer.color] || PALETTE[1];
      node.textContent = initials(peer.name);
      node.title = peer.id === this.me ? `${peer.name} (вы) — нажмите, чтобы переименоваться` : peer.name;
      if (peer.id === this.me) node.addEventListener('click', () => this.rename());
      holder.append(node);
    }
    if (ordered.length > 4) {
      const more = document.createElement('span');
      more.className = 'peer peer-more';
      more.textContent = '+' + (ordered.length - 4);
      more.title = ordered.slice(4).map(peer => peer.name).join(', ');
      holder.append(more);
    }
    holder.setAttribute('aria-label', `Сейчас на странице: ${peers.length}`);
    for (const id of Array.from(this.cursors.keys())) {
      if (!peers.some(peer => peer.id === id)) this.dropCursor(id);
    }
  }

  rename() {
    const name = prompt('Как вас подписать для остальных?', this.name);
    if (!name || !name.trim()) return;
    this.name = name.trim().slice(0, 24);
    save('board-name', this.name);
    this.send({ t: 'n', name: this.name, c: this.color });
  }

  remote({ from, ops }) {
    for (const op of ops) {
      switch (op.t) {
        case 'b':
          this.addStroke({ id: op.id, a: op.a, c: op.c, w: op.w, k: op.k, p: op.p.slice() });
          this.touchLaser(op);
          break;
        case 'p': {
          const stroke = this.strokes.get(op.id);
          if (!stroke) break;
          for (const value of op.p) stroke.p.push(value);
          this.renderStroke(stroke);
          this.touchLaser(stroke);
          break;
        }
        case 'e': {
          const stroke = this.strokes.get(op.id);
          if (stroke) {
            stroke.done = true;
            this.touchLaser(stroke);
          }
          break;
        }
        case 'x':
          op.ids.forEach(id => this.removeStroke(id));
          break;
        case 'c':
          this.clearStrokes(op.a);
          break;
        case 'm':
          this.moveCursor(from, op);
          break;
        case 'l':
          this.dropCursor(from);
          break;
        default:
          break;
      }
    }
  }

  moveCursor(id, op) {
    const entry = this.surfaces.get(op.a);
    const peer = this.peers.find(item => item.id === id);
    if (!entry || !peer) return;
    let cursor = this.cursors.get(id);
    if (!cursor) {
      const node = document.createElement('div');
      node.className = 'cursor';
      node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-cursor"/></svg><span></span>';
      cursor = { node };
      this.cursors.set(id, cursor);
    }
    const color = PALETTE[peer.color] || PALETTE[1];
    cursor.node.querySelector('svg').style.fill = color;
    const label = cursor.node.querySelector('span');
    label.textContent = peer.name;
    label.style.background = color;
    if (cursor.anchor !== op.a) {
      entry.surface.append(cursor.node);
      cursor.anchor = op.a;
    }
    cursor.x = op.x;
    cursor.y = op.y;
    this.placeCursor(cursor);
  }

  placeCursor(cursor) {
    const entry = this.surfaces.get(cursor.anchor);
    if (!entry) return;
    const x = cursor.x / SCALE * entry.width;
    const y = cursor.y / SCALE * entry.width;
    cursor.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  dropCursor(cid) {
    const cursor = this.cursors.get(cid);
    if (!cursor) return;
    cursor.node.remove();
    this.cursors.delete(cid);
  }

  undo() {
    while (this.mine.length) {
      const id = this.mine.pop();
      if (this.strokes.has(id)) {
        this.removeStroke(id);
        this.send({ t: 'x', ids: [id] });
        return;
      }
    }
    toast('Отменять нечего');
  }

  buildDock() {
    this.dock = $('#dock');
    const swatches = $('#swatches');
    PALETTE.forEach((color, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = color;
      button.title = index ? 'Цвет пера' : 'Цвет текста';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(index === this.penColor));
      button.addEventListener('click', () => {
        this.penColor = index;
        save('board-pen', String(index));
        swatches.querySelectorAll('.swatch').forEach((node, position) => node.setAttribute('aria-pressed', String(position === index)));
        if (this.tool === 'eraser') this.setTool('pen');
      });
      swatches.append(button);
    });
    swatches.style.display = 'inline-flex';
    swatches.style.gap = '6px';
    const widths = $('#widths');
    for (const width of PEN_WIDTHS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool';
      button.title = 'Толщина пера';
      button.setAttribute('aria-label', `Толщина ${width}`);
      button.setAttribute('aria-pressed', String(width === this.penWidth));
      const dot = document.createElement('span');
      dot.className = 'width-dot';
      dot.style.width = dot.style.height = `${Math.max(4, width * 1.6)}px`;
      button.append(dot);
      button.addEventListener('click', () => {
        this.penWidth = width;
        save('board-width', String(width));
        widths.querySelectorAll('.tool').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
      });
      widths.append(button);
    }
    widths.style.display = 'inline-flex';
    this.dock.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => this.setTool(button.dataset.tool)));
    $('#undo').addEventListener('click', () => this.undo());
    $('#share').addEventListener('click', () => this.share());
    $('#clear').addEventListener('click', () => this.askClear());
    $('#draw-toggle').addEventListener('click', () => this.setDrawing(!this.drawing));
    const board = document.querySelector('.board');
    if (board) {
      new IntersectionObserver(entries => {
        this.boardVisible = entries.some(entry => entry.isIntersecting);
        this.updateDock();
      }, { threshold: 0.25 }).observe(board);
    }
  }

  setTool(tool) {
    this.tool = tool;
    this.dock.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    document.body.classList.toggle('erasing', tool === 'eraser');
    document.querySelectorAll('.board').forEach(board => board.classList.toggle('erasing', tool === 'eraser'));
  }

  setDrawing(drawing) {
    this.drawing = drawing;
    document.body.classList.toggle('drawing', drawing);
    $('#draw-toggle').setAttribute('aria-pressed', String(drawing));
    this.updateDock();
  }

  updateDock() {
    const shown = this.drawing || this.boardVisible;
    this.dock.classList.toggle('shown', Boolean(shown));
    $('#dock-note').textContent = this.drawing ? 'Рисуете поверх страницы' : '';
  }

  askClear() {
    const note = $('#dock-note');
    note.replaceChildren();
    const wrap = document.createElement('span');
    wrap.className = 'confirm';
    wrap.append('Стереть всё у всех?');
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'danger';
    yes.textContent = 'Стереть';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Отмена';
    wrap.append(yes, no);
    note.append(wrap);
    yes.addEventListener('click', () => {
      this.clearStrokes('*');
      this.send({ t: 'c', a: '*' });
      this.mine = [];
      this.updateDock();
    });
    no.addEventListener('click', () => this.updateDock());
  }

  async share() {
    const url = new URL(location.href);
    url.hash = '';
    if (this.room === 'main') url.searchParams.delete('room');
    else url.searchParams.set('room', this.room);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast('Ссылка на эту комнату скопирована');
    } catch {
      prompt('Скопируйте ссылку:', url.toString());
    }
  }

  renderRoomLine() {
    const line = $('#room-line');
    if (!line) return;
    line.replaceChildren();
    const text = document.createElement('span');
    const action = document.createElement('a');
    action.href = '#board';
    if (this.room === 'main') {
      text.textContent = 'общая комната · ';
      action.textContent = 'отдельная комната';
      action.addEventListener('click', event => {
        event.preventDefault();
        this.switchRoom(randomId(8).toLowerCase());
        this.share();
      });
    } else {
      text.textContent = `комната ${this.room} · видят только те, у кого эта ссылка · `;
      action.textContent = 'в общую';
      action.addEventListener('click', event => {
        event.preventDefault();
        this.switchRoom('main');
      });
    }
    line.append(text, action);
  }

  switchRoom(room) {
    this.room = room;
    const url = new URL(location.href);
    if (room === 'main') url.searchParams.delete('room');
    else url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    this.clearStrokes('*');
    this.mine = [];
    this.renderRoomLine();
    this.connect();
  }

  bindKeys() {
    document.addEventListener('keydown', event => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (this.drawing || this.boardVisible) {
          event.preventDefault();
          this.undo();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'd' || key === 'в') this.setDrawing(!this.drawing);
      else if (key === 'escape' && this.drawing) this.setDrawing(false);
      else if ((key === 'p' || key === 'з') && (this.drawing || this.boardVisible)) this.setTool('pen');
      else if ((key === 'l' || key === 'д') && (this.drawing || this.boardVisible)) this.setTool('laser');
      else if ((key === 'e' || key === 'у') && (this.drawing || this.boardVisible)) this.setTool('eraser');
    });
  }
}

let toastTimer = 0;
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('shown'), 2600);
}

export function startBoard() {
  return new Board();
}
