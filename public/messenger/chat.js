import { toast } from './board.js';

const LIMIT = 40;

function nanos(value) {
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value || '');
  return match ? `${match[1]}.${(match[2] || '').padEnd(9, '0')}` : '';
}

function row(message, fresh, from) {
  const item = document.createElement('li');
  if (fresh) item.className = 'fresh';
  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = document.createElement('time');
  time.textContent = nanos(message.sendTime).slice(11) || '—';
  meta.append(time);
  if (from !== undefined) meta.append(Object.assign(document.createElement('i'), { className: `from c${from}`, textContent: `клиент ${from + 1}` }));
  else meta.append(Object.assign(document.createElement('b'), { textContent: message.author }));
  const text = document.createElement('span');
  text.textContent = message.text;
  item.append(meta, text);
  return item;
}

function pulse(node, name) {
  node.classList.remove(name);
  void node.offsetWidth;
  node.classList.add(name);
}

export function mountChat(board) {
  const root = document.getElementById('chat-app');
  const columns = Array.from(root.querySelectorAll('[data-client]'));
  const logs = columns.map(column => column.querySelector('.chat-log'));
  const stamps = root.querySelector('.chat-stamps');
  const wires = Array.from(root.querySelectorAll('[data-wire]'));
  const check = document.getElementById('chat-check');
  const burst = document.getElementById('chat-burst');
  const clear = document.getElementById('chat-clear');
  const state = { ports: [], online: [], logs: [[], []], stamps: [] };

  const renderLog = (index, fresh) => {
    const log = logs[index];
    log.replaceChildren(...state.logs[index].map((message, position) => row(message, position >= state.logs[index].length - fresh)));
    log.scrollTop = log.scrollHeight;
  };

  const renderStamps = fresh => {
    const ordered = [...state.stamps].sort((a, b) => nanos(a.sendTime).localeCompare(nanos(b.sendTime)));
    stamps.replaceChildren(...ordered.map(stamp => row(stamp, fresh.includes(stamp), stamp.c)));
    stamps.scrollTop = stamps.scrollHeight;
  };

  const renderCheck = () => {
    const keys = state.logs.map(log => log.map(message => nanos(message.sendTime) + '\u0000' + message.text));
    const shared = keys[0].filter(key => keys[1].includes(key));
    const mirror = keys[1].filter(key => keys[0].includes(key));
    check.replaceChildren();
    if (!state.ports.length) {
      check.textContent = 'живой сервер выключен';
      return;
    }
    if (!state.online.every(Boolean)) {
      check.textContent = 'клиенты не отвечают';
      return;
    }
    if (!shared.length) return;
    const same = shared.join('\u0001') === mirror.join('\u0001');
    const rising = keys.every(list => list.every((key, index) => index === 0 || key > list[index - 1]));
    for (const [ok, text] of [[same, same ? 'порядок у клиентов один' : 'порядок у клиентов разный'], [rising, rising ? 'sendTime растёт' : 'sendTime не растёт']]) {
      const part = document.createElement('span');
      part.className = 'status ' + (ok ? 'ok' : 'fail');
      part.innerHTML = `<svg aria-hidden="true"><use href="#i-${ok ? 'check' : 'x'}"/></svg>`;
      part.append(document.createTextNode(text));
      check.append(part);
    }
  };

  const renderState = () => {
    columns.forEach((column, index) => {
      const port = state.ports[index];
      column.querySelector('[data-port]').textContent = port ? `HTTP :${port}` : 'HTTP';
      const online = Boolean(state.online[index]);
      column.classList.toggle('offline', !online);
      column.querySelectorAll('input, button').forEach(control => {
        control.disabled = !online;
      });
    });
    burst.disabled = !state.ports.length || !state.online.every(Boolean);
    clear.disabled = !state.ports.length;
    renderCheck();
  };

  const post = async body => {
    const current = board();
    if (!current) return false;
    try {
      const response = await fetch(`api/chat?room=${encodeURIComponent(current.room)}&cid=${current.cid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.ok) return true;
      const answer = await response.json().catch(() => ({}));
      toast(answer.error || 'Не получилось отправить');
    } catch {
      toast('Нет связи с сервером');
    }
    return false;
  };

  columns.forEach((column, index) => {
    const form = column.querySelector('form');
    const input = form.querySelector('input');
    let sending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      if (await post({ c: index, text })) input.value = '';
      sending = false;
      input.focus();
    });
  });
  burst.addEventListener('click', () => post({ burst: true }));
  clear.addEventListener('click', () => post({ clear: true }));

  return {
    restore(snapshot) {
      const known = Boolean(snapshot && snapshot.ports.length === columns.length);
      state.ports = known ? snapshot.ports : [];
      state.online = known ? snapshot.online : [];
      renderState();
    },
    event(data) {
      if (data.t === 'status') {
        state.online = data.online;
        renderState();
      } else if (data.t === 'clear') {
        state.logs = columns.map(() => []);
        state.stamps = [];
        state.logs.forEach((log, index) => renderLog(index, 0));
        renderStamps([]);
        renderCheck();
        toast('Чат очистили');
      } else if (data.t === 'sent') {
        const stamp = { c: data.c, author: data.author, text: data.text, sendTime: data.sendTime };
        state.stamps = state.stamps.concat(stamp).slice(-LIMIT);
        renderStamps([stamp]);
        if (wires[data.c]) pulse(wires[data.c], 'up');
      } else if (data.t === 'got' && state.logs[data.c]) {
        state.logs[data.c] = state.logs[data.c].concat(data.m).slice(-LIMIT);
        renderLog(data.c, data.m.length);
        if (wires[data.c]) pulse(wires[data.c], 'down');
        renderCheck();
      }
    }
  };
}
