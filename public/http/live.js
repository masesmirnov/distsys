import { toast } from './board.js';
import { ICON, element } from './code.js';
import { Picker } from './picker.js';

const SPLIT_NOTE = '+160 мс';
const decoder = new TextDecoder('utf-8');
const strict = new TextDecoder('utf-8', { fatal: true });

const PRESETS = [
  ['GET /', { method: 'GET', path: '/' }],
  ['GET /hello.txt', { method: 'GET', path: '/hello.txt' }],
  ['то же с gzip', { method: 'GET', path: '/hello.txt', gzip: true }],
  ['POST /notes.txt', { method: 'POST', path: '/notes.txt', body: 'hello world' }],
  ['POST папки', { method: 'POST', path: '/docs/new', create: true }],
  ['PUT /hello.txt', { method: 'PUT', path: '/hello.txt', body: 'x' }],
  ['DELETE /docs', { method: 'DELETE', path: '/docs' }],
  ['…с Remove-Directory', { method: 'DELETE', path: '/docs', remove: true }],
  ['DELETE /', { method: 'DELETE', path: '/', remove: true }],
  ['чужой Host', { method: 'GET', path: '/', host: 'other' }],
  ['три куска', { method: 'POST', path: '/split.txt', body: 'hello world', split: true }]
];

function bytesOf(base64) {
  const text = atob(base64 || '');
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

function headEnd(bytes) {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) return i;
  }
  return -1;
}

function glyph(code) {
  return element('span', 'glyph', code === 13 ? '\\r' : '\\n');
}

function plural(count, one, few, many) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export function sized(count) {
  return `${count.toLocaleString('ru-RU')} ${plural(count, 'байт', 'байта', 'байт')}`;
}

function hex(bytes, limit) {
  const shown = Array.from(bytes.slice(0, limit), byte => byte.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > limit ? shown + ' …' : shown;
}

function renderHead(pre, bytes, end, cuts) {
  const stop = end < 0 ? bytes.length : end + 4;
  let line = element('span', 'wline');
  let run = null;
  let runPiece = -1;
  const piece = offset => cuts.filter(cut => cut <= offset).length;
  const flush = () => {
    if (run) line.append(run);
    run = null;
  };
  const lines = [];
  for (let offset = 0; offset < stop; offset++) {
    if (cuts.includes(offset)) {
      flush();
      line.append(element('span', 'cut', SPLIT_NOTE));
    }
    const byte = bytes[offset];
    if (byte === 13 || byte === 10) {
      flush();
      const mark = glyph(byte);
      mark.classList.add(`p${piece(offset)}`);
      line.append(mark);
      if (byte === 10) {
        lines.push(line);
        line = element('span', 'wline');
      }
      continue;
    }
    if (!run || runPiece !== piece(offset)) {
      flush();
      runPiece = piece(offset);
      run = element('span', `p${runPiece}`);
    }
    run.textContent += String.fromCharCode(byte);
  }
  flush();
  if (line.childNodes.length) lines.push(line);
  lines.forEach((row, index) => {
    if (index === 0) row.classList.add('first');
    if (/^content-length:/i.test(row.textContent)) row.classList.add('len');
    pre.append(row);
  });
  if (end >= 0) lines[lines.length - 1].append(element('span', 'wnote', 'пустая строка: заголовки кончились'));
}

function renderBody(pre, body, gzip, decoded, piece) {
  if (!body.length) return;
  const box = element('span', `wbody p${piece}`);
  if (gzip) {
    box.append(element('span', 'binary', hex(body, 36)));
    if (decoded !== null) {
      const plain = element('span', 'unzipped');
      plain.append(element('i', '', 'распаковано: '), document.createTextNode(decoded));
      box.append(plain);
    }
  } else {
    let text = null;
    try {
      text = strict.decode(body);
    } catch {
      text = null;
    }
    if (text === null || /[\x00-\x08\x0e-\x1f]/.test(text)) box.append(element('span', 'binary', hex(body, 48)));
    else {
      text.split('\n').forEach((part, index, all) => {
        box.append(document.createTextNode(part));
        if (index < all.length - 1) {
          box.append(glyph(10), document.createElement('br'));
        }
      });
    }
  }
  pre.append(box);
}

function renderWire(pre, bytes, parts, options = {}) {
  pre.replaceChildren();
  if (!bytes.length) {
    pre.append(element('span', 'wempty', options.empty || 'пусто'));
    return;
  }
  const cuts = [];
  let total = 0;
  for (const size of parts.slice(0, -1)) {
    total += size;
    cuts.push(total);
  }
  pre.classList.toggle('split', cuts.length > 0);
  const end = headEnd(bytes);
  renderHead(pre, bytes, end, cuts);
  if (end >= 0) {
    const body = bytes.slice(end + 4);
    const label = element('span', 'wlabel', `тело, ${sized(body.length)}`);
    if (body.length || options.response) pre.append(label);
    renderBody(pre, body, options.gzip, options.decoded ?? null, cuts.length);
  }
}

function contentLength(bytes) {
  const end = headEnd(bytes);
  const head = String.fromCharCode(...bytes.slice(0, end < 0 ? bytes.length : end));
  const match = /content-length:\s*(\d+)/i.exec(head);
  return match ? Number(match[1]) : null;
}

function statusOf(entry) {
  if (!entry.status) return entry.error === 'timeout' ? 'нет ответа' : 'обрыв';
  return String(entry.status);
}

export function mountLive(board, hooks) {
  const root = document.getElementById('live-app');
  const form = root.querySelector('form');
  const fields = form.elements;
  const method = new Picker(['GET', 'POST', 'PUT', 'DELETE'].map(name => [name, name]), 'Метод', value => {
    method.set(value);
    syncFields();
  });
  form.querySelector('[data-method]').replaceWith(method.root);
  const wires = { request: root.querySelector('[data-wire="request"]'), response: root.querySelector('[data-wire="response"]') };
  const metas = { request: root.querySelector('[data-meta="request"]'), response: root.querySelector('[data-meta="response"]') };
  const treeBox = root.querySelector('[data-tree]');
  const historyBox = document.getElementById('live-history');
  const stateBox = document.getElementById('live-state');
  const resetButton = document.getElementById('live-reset');
  const presetsBox = document.getElementById('live-presets');
  const state = { enabled: false, broken: false, online: false, domain: '', tree: null, history: [], shown: null };
  let sending = false;

  const syncFields = () => {
    root.querySelectorAll('[data-only]').forEach(node => {
      node.hidden = !node.dataset.only.split(' ').includes(method.value);
    });
  };

  const show = entry => {
    state.shown = entry ? entry.id : null;
    if (!entry) {
      renderWire(wires.request, new Uint8Array(), [], { empty: 'отправьте запрос: его байты появятся здесь' });
      renderWire(wires.response, new Uint8Array(), [], { empty: 'а здесь ответ server.py' });
      metas.request.textContent = '';
      metas.response.textContent = '';
    } else {
      const request = bytesOf(entry.request);
      const response = bytesOf(entry.response);
      renderWire(wires.request, request, entry.parts);
      renderWire(wires.response, response, [response.length], { response: true, gzip: entry.decoded !== null, decoded: entry.decoded, empty: 'сервер закрыл соединение молча' });
      metas.request.textContent = `${sized(request.length)}` + (entry.parts.length > 1 ? `, куски ${entry.parts.join(' + ')}` : '') + `, ${entry.by}`;
      const declared = contentLength(response);
      const end = headEnd(response);
      const body = end < 0 ? 0 : response.length - end - 4;
      metas.response.textContent = `${statusOf(entry)} за ${entry.ms.toLocaleString('ru-RU')} мс` + (declared !== null ? `, Content-Length ${declared} = тело ${body}` : '');
    }
    historyBox.querySelectorAll('button').forEach(button => button.classList.toggle('current', Number(button.dataset.id) === state.shown));
  };

  const renderHistory = () => {
    historyBox.replaceChildren(...[...state.history].reverse().map(entry => {
      const item = element('li');
      const button = element('button', 'history-row');
      button.type = 'button';
      button.dataset.id = String(entry.id);
      const request = bytesOf(entry.request);
      const first = decoder.decode(request.slice(0, Math.max(0, request.indexOf(13)))) || '—';
      button.append(element('span', `code s${String(entry.status || 0)[0]}`, statusOf(entry)), element('code', '', first.replace(/ HTTP\/1\.1$/, '')), element('small', '', entry.by));
      button.addEventListener('click', () => show(entry));
      item.append(button);
      return item;
    }));
  };

  const renderTree = () => {
    treeBox.replaceChildren();
    if (!state.tree) {
      treeBox.append(element('li', 'tree-empty', state.enabled ? 'ждём server.py…' : 'живой сервер выключен'));
      return;
    }
    const build = (nodes, prefix, holder) => {
      for (const node of nodes) {
        const item = element('li', node.dir ? 'dir' : 'file');
        const path = `${prefix}/${node.name}`;
        const button = element('button', 'node', `${ICON(node.dir ? 'folder' : 'file')}<span></span>`);
        button.type = 'button';
        button.title = `GET ${path}`;
        button.querySelector('span').textContent = node.name;
        if (!node.dir) button.append(element('small', '', sized(node.size)));
        button.addEventListener('click', () => send({ method: 'GET', path }));
        item.append(button);
        if (node.dir && node.children.length) {
          const list = element('ul');
          build(node.children, path, list);
          item.append(list);
        }
        holder.append(item);
      }
    };
    const rootItem = element('li', 'dir root');
    const rootButton = element('button', 'node', `${ICON('folder')}<span>/</span>`);
    rootButton.type = 'button';
    rootButton.title = 'GET /';
    rootButton.addEventListener('click', () => send({ method: 'GET', path: '/' }));
    rootItem.append(rootButton);
    const list = element('ul');
    build(state.tree, '', list);
    rootItem.append(list);
    treeBox.append(rootItem);
  };

  const renderState = () => {
    const ready = state.enabled && state.online;
    stateBox.textContent = !state.enabled ? 'живой сервер выключен' : ready ? `server.py запущен с --server-domain ${state.domain}` : 'server.py не отвечает';
    form.querySelectorAll('select, input, textarea, button').forEach(control => {
      control.disabled = !state.enabled;
    });
    resetButton.disabled = !state.enabled;
    presetsBox.querySelectorAll('button').forEach(button => {
      button.disabled = !state.enabled;
    });
  };

  const post = async body => {
    const current = board();
    if (!current) return null;
    try {
      const response = await fetch(`api/live?room=${encodeURIComponent(current.room)}&cid=${current.cid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const answer = await response.json().catch(() => ({}));
      if (response.ok) return answer;
      toast(answer.error || 'Не получилось отправить');
    } catch {
      toast('Нет связи с сервером страницы');
    }
    return null;
  };

  const send = async spec => {
    if (sending || !state.enabled) return null;
    sending = true;
    method.set(spec.method);
    fields.path.value = spec.path;
    fields.body.value = spec.body || '';
    fields.create.checked = Boolean(spec.create);
    fields.remove.checked = Boolean(spec.remove);
    fields.gzip.checked = Boolean(spec.gzip);
    fields.other.checked = spec.host === 'other';
    fields.split.checked = Boolean(spec.split);
    syncFields();
    const answer = await post({ host: 'domain', ...spec });
    sending = false;
    return answer;
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    send({
      method: method.value,
      path: fields.path.value.trim() || '/',
      body: fields.body.value,
      create: fields.create.checked,
      remove: fields.remove.checked,
      gzip: fields.gzip.checked,
      host: fields.other.checked ? 'other' : 'domain',
      split: fields.split.checked
    });
  });
  resetButton.addEventListener('click', () => post({ reset: true }));
  presetsBox.replaceChildren(...PRESETS.map(([label, spec]) => {
    const button = element('button', 'chip-button preset');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => send(spec));
    return button;
  }));
  syncFields();
  show(null);
  renderTree();
  renderState();

  return {
    restore(snapshot) {
      state.enabled = Boolean(snapshot && snapshot.enabled);
      state.broken = Boolean(snapshot && snapshot.broken);
      state.online = Boolean(snapshot && snapshot.online);
      state.domain = snapshot ? snapshot.domain : '';
      state.tree = snapshot ? snapshot.tree : null;
      state.history = snapshot ? snapshot.history : [];
      renderHistory();
      renderTree();
      renderState();
      show(state.history[state.history.length - 1] || null);
      hooks.gaps(snapshot && snapshot.gaps ? snapshot.gaps : {}, state.enabled && state.broken);
    },
    event(data) {
      if (data.t === 'status') {
        state.online = data.online;
        renderState();
      } else if (data.t === 'reset') {
        state.online = true;
        state.tree = data.tree;
        state.history = [];
        renderHistory();
        renderTree();
        renderState();
        show(null);
        hooks.gaps({}, state.enabled && state.broken);
        if (data.by) toast(`${data.by}: папку вернули как было`);
      } else if (data.t === 'exchange') {
        state.online = true;
        state.history = state.history.concat(data.entry).slice(-12);
        if (data.tree) state.tree = data.tree;
        renderHistory();
        if (data.tree) renderTree();
        renderState();
        show(data.entry);
      } else if (data.t === 'tree') {
        state.tree = data.tree;
        renderTree();
      } else if (data.t === 'gap') {
        hooks.gap(data.n, data.result);
      }
    },
    checkGap(index) {
      return post({ gap: index });
    }
  };
}
