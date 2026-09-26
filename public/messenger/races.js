import { ICON, element, highlight } from './code.js';

const STEP_MS = 1100;

const PYTHON = {
  keywords: new Set(['class', 'def', 'if', 'else', 'return', 'while', 'for', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'from', 'import', 'with', 'try', 'except', 'finally', 'yield', 'lambda', 'self', 'pass']),
  builtins: new Set(['max', 'set', 'int', 'str', 'len', 'Timestamp']),
  definers: new Set(['def', 'class'])
};

const TAGS = {
  server: {
    21: 'один поток за раз',
    22: 'строго больше прошлого',
    31: 'все подписки',
    32: 'в очередь потока',
    36: 'своя очередь',
    38: 'подписка началась',
    39: 'разбудит при отмене',
    42: 'спит до сообщения',
    45: 'в поток клиенту',
    48: 'отписка'
  },
  client: {
    27: 'атомарно',
    28: 'копия',
    29: 'буфер пуст',
    33: 'тот же lock',
    34: 'в конец',
    77: 'подписка',
    79: 'по порядку',
    81: 'обрыв',
    82: 'и заново'
  }
};

const SOURCES = { server: 'solution/server/server.py', client: 'solution/client/client.py' };

const CHANGES = {
  'send:nolock': { removed: [21], dedent: [[22, 32]] },
  'send:outside': { moved: [[31, 32]], dedent: [[31, 32]] },
  'subscribe:nolock': { removed: [37], dedent: [[38, 38]] },
  'flush:nolock': { removed: [27, 33], dedent: [[28, 29], [34, 34]] },
  'reconnect:noretry': { removed: [76, 81, 82], dedent: [[77, 80]] }
};

const STATES = {
  ready: 'ещё не начал',
  lock: 'ждёт lock',
  wait: 'ждёт',
  sleep: 'спит 1 с',
  done: 'готово',
  error: 'упал'
};

class Lock {
  constructor() {
    this.owner = null;
  }
}

class Thread {
  constructor(index, spec) {
    this.index = index;
    this.spec = spec;
    this.name = spec.name;
    this.lines = [];
    this.state = 'ready';
    this.vars = [];
    this.waitFor = null;
    this.program = null;
  }

  set(name, value) {
    const row = this.vars.find(item => item[0] === name);
    if (row) row[1] = value;
    else this.vars.push([name, value]);
  }

  blocked() {
    return Boolean(this.waitFor && this.waitFor());
  }

  live() {
    return this.state !== 'done' && this.state !== 'error';
  }
}

function* acquire(thread, lock, line) {
  if (lock.owner) {
    thread.state = 'lock';
    thread.waitFor = () => lock.owner !== null;
    yield { lines: [line], note: 'ждёт lock' };
    thread.waitFor = null;
  }
  lock.owner = thread;
  thread.state = 'run';
  yield { lines: [line], note: 'взял lock' };
}

function release(thread, lock) {
  if (lock.owner === thread) lock.owner = null;
}

function* sleepUntil(thread, blocked, lines, note) {
  while (blocked()) {
    thread.state = 'wait';
    thread.waitFor = blocked;
    yield { lines, note };
    thread.waitFor = null;
    thread.state = 'run';
  }
}

const queue = (name, who) => ({ name, who, items: [], sent: [] });
const names = items => items.map(item => item.text).join(', ');

function* sendMessage(world, thread, { locked, outside, text }) {
  if (locked) yield* acquire(thread, world.lock, 21);
  const now = world.clock.shift();
  const stamp = Math.max(now, world.last + 1);
  thread.set('send_time_ns', String(stamp));
  yield { lines: [22], note: `time_ns() = ${now} → max(${now}, ${world.last} + 1) = ${stamp}` };
  world.last = stamp;
  yield { lines: [23], note: `_last_time_ns = ${stamp}` };
  const item = { author: thread.index, text, time: stamp };
  thread.set('message', `«${text}» · ${stamp}`);
  yield { lines: [24, 25, 26, 27, 28, 29, 30], note: `ChatMessage «${text}», sendTime = ${stamp}` };
  if (locked && outside) {
    release(thread, world.lock);
    yield { lines: [21], note: 'вышел из with — lock свободен до рассылки' };
  }
  const size = world.subs.length;
  for (let index = 0; ; index++) {
    if (world.subs.length !== size) {
      release(thread, world.lock);
      world.errors.push(text);
      return { lines: [31], note: 'RuntimeError: Set changed size during iteration', error: true };
    }
    if (index >= size) break;
    const target = world.subs[index];
    target.items.push(item);
    yield { lines: [31, 32], note: `${target.name} ← «${text}»` };
  }
  const held = world.lock.owner === thread;
  release(thread, world.lock);
  world.replies.push(item);
  return { lines: [33], note: `${held ? 'lock свободен · ' : ''}ответ: sendTime = ${stamp}` };
}

function* readMessages(world, thread, { locked }) {
  const own = queue('q2', 'клиент 2');
  thread.set('subscriber', 'q2');
  yield { lines: [36], note: 'новая SimpleQueue — ещё не в подписках' };
  if (locked) yield* acquire(thread, world.lock, 37);
  world.subs.push(own);
  release(thread, world.lock);
  yield { lines: [38], note: `q2 в _subscribers — подписка началась${locked ? ' · lock свободен' : ''}` };
  yield { lines: [39], note: 'add_callback: при отмене положит None' };
  for (;;) {
    yield* sleepUntil(thread, () => !own.items.length, [42], 'get() спит: очередь пуста');
    const item = own.items.shift();
    thread.set('message', `«${item.text}» · ${item.time}`);
    yield { lines: [42, 43], note: `get() → «${item.text}»` };
    own.sent.push(item);
    yield { lines: [45], note: `yield: «${item.text}» ушло клиенту 2` };
  }
}

function* consume(world, thread, { locked }) {
  const item = world.incoming.shift();
  thread.set('message', `«${item.text}»`);
  yield { lines: [77, 78, 79, 80], note: `из потока пришло «${item.text}» → put_message` };
  if (locked) yield* acquire(thread, world.lock, 33);
  world.messages.push(item);
  const held = world.lock.owner === thread;
  release(thread, world.lock);
  yield { lines: [34], note: `_messages += «${item.text}»${held ? ' · lock свободен' : ''}` };
  yield* sleepUntil(thread, () => true, [77], 'ждёт следующее сообщение из потока');
}

function* collect(world, thread, { locked, number }) {
  if (locked) yield* acquire(thread, world.lock, 27);
  const copy = world.messages.slice();
  thread.set('messages', `[${names(copy)}]`);
  yield { lines: [28], note: `deepcopy → [${names(copy)}]` };
  world.messages = [];
  yield { lines: [29], note: '_messages = []' };
  const held = world.lock.owner === thread;
  release(thread, world.lock);
  world.replies.push({ number, items: copy });
  return { lines: [30], note: `${held ? 'lock свободен · ' : ''}ответ ${number}: [${names(copy)}]` };
}

function* serve(world, thread, { locked }) {
  yield yield* collect(world, thread, { locked, number: 1 });
  return yield* collect(world, thread, { locked, number: 2 });
}

function* reader(world, thread, { retry }) {
  for (;;) {
    yield* sleepUntil(thread, () => world.server !== 'up', [77, 78], 'wait_for_ready: ждёт, пока сервер поднимется');
    world.stream = 'open';
    yield { lines: retry ? [75, 76, 77, 78] : [75, 77, 78], note: 'ReadMessages — сервер зарегистрировал подписку' };
    for (;;) {
      yield* sleepUntil(thread, () => world.stream === 'open' && !world.inbox.length, [77], 'ждёт следующее сообщение');
      if (world.stream !== 'open') break;
      const item = world.inbox.shift();
      world.messages.push(item);
      thread.set('message', `«${item.text}»`);
      yield { lines: [79, 80], note: `«${item.text}» → put_message` };
    }
    if (!retry) return { lines: [77], note: 'grpc.RpcError никто не поймал — поток-читатель умер', error: true };
    thread.set('message', '—');
    yield { lines: [81], note: 'except grpc.RpcError: поток оборван' };
    thread.state = 'sleep';
    yield { lines: [82], note: 'time.sleep(1) — и на новый круг' };
    thread.state = 'run';
  }
}

function deliver(world, text) {
  const item = { author: 1, text };
  if (world.stream === 'open') {
    world.inbox.push(item);
    return { lines: [], note: `сервер принял «${text}» → в поток клиента` };
  }
  world.missed.push(item);
  return { lines: [], note: `сервер принял «${text}», а подписки клиента нет` };
}

function* network(world) {
  yield deliver(world, 'm1');
  world.stream = 'broken';
  world.server = 'down';
  yield { lines: [], note: 'сервер перезапускается — поток оборван' };
  world.server = 'up';
  yield { lines: [], note: 'сервер снова принимает вызовы' };
  yield deliver(world, 'm2');
  return deliver(world, 'm3');
}

function serverWorld(subs) {
  return { lock: new Lock(), last: 0, clock: [1000, 1000], subs: subs.map(([name, who]) => queue(name, who)), replies: [], errors: [] };
}

const LABS = {
  send: {
    variants: { ok: 'решение', nolock: 'без lock', outside: 'рассылка вне lock' },
    panes: [{ file: 'server', title: 'SendMessage', range: [20, 33] }],
    world: () => serverWorld([['q1', 'клиент 1'], ['q2', 'клиент 2']]),
    threads: [
      { name: 'поток 1', call: 'SendMessage(alice, «привет»)', run: (world, thread, variant) => sendMessage(world, thread, { locked: variant !== 'nolock', outside: variant === 'outside', text: 'привет' }) },
      { name: 'поток 2', call: 'SendMessage(bob, «hi»)', run: (world, thread, variant) => sendMessage(world, thread, { locked: variant !== 'nolock', outside: variant === 'outside', text: 'hi' }) }
    ],
    schedules: {
      ok: [0, 1, 0, 0, 0, 0, 0, 0],
      nolock: [0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1],
      outside: [0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1]
    },
    render: renderServer,
    verdict: world => {
      const stamps = world.replies.map(item => item.time);
      const orders = world.subs.map(target => names(target.items));
      const problems = [];
      if (new Set(stamps).size < stamps.length) problems.push(`sendTime совпал: ${stamps.join(' = ')}`);
      if (orders.some(order => order !== orders[0])) problems.push(`порядок разный: ${world.subs.map(target => `${target.name} [${names(target.items)}]`).join(', ')}`);
      const falling = world.subs.find(target => target.items.some((item, index) => index > 0 && item.time < target.items[index - 1].time));
      if (falling) problems.push(`в ${falling.name} sendTime убывает`);
      if (problems.length) return { ok: false, text: problems.join(' · ') };
      return { ok: true, text: `q1 и q2: [${orders[0]}] · sendTime ${stamps.join(' < ')}` };
    }
  },
  subscribe: {
    variants: { ok: 'решение', nolock: 'add без lock' },
    panes: [
      { file: 'server', title: 'SendMessage', range: [20, 33] },
      { file: 'server', title: 'ReadMessages', range: [35, 48] }
    ],
    world: () => serverWorld([['q1', 'клиент 1']]),
    threads: [
      { name: 'поток 1', call: 'SendMessage(alice, «m1»)', run: (world, thread) => sendMessage(world, thread, { locked: true, outside: false, text: 'm1' }) },
      { name: 'поток 2', call: 'ReadMessages() · клиент 2', run: (world, thread, variant) => readMessages(world, thread, { locked: variant !== 'nolock' }) },
      { name: 'поток 3', call: 'SendMessage(bob, «m2»)', run: (world, thread) => sendMessage(world, thread, { locked: true, outside: false, text: 'm2' }) }
    ],
    schedules: {
      ok: [0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
      nolock: [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2]
    },
    render: renderServer,
    verdict: world => {
      if (world.errors.length) return { ok: false, text: `SendMessage «${world.errors[0]}» упал с RuntimeError, а q1 его уже получил` };
      const late = world.subs.find(target => target.name === 'q2');
      const got = late ? names([...late.sent, ...late.items]) : '';
      return got === 'm2'
        ? { ok: true, text: 'клиент 2 подписался после m1: пришло только m2' }
        : { ok: false, text: `клиенту 2 пришло [${got}]` };
    }
  },
  flush: {
    variants: { ok: 'решение', nolock: 'без lock' },
    panes: [
      { file: 'client', title: 'PostBox', range: [21, 34] },
      { file: 'client', title: '_consume_messages', range: [74, 82] }
    ],
    world: () => ({ lock: new Lock(), messages: [{ author: 0, text: 'm1' }], incoming: [{ author: 0, text: 'm2' }], replies: [] }),
    threads: [
      { name: 'читатель', call: '_consume_messages', run: (world, thread, variant) => consume(world, thread, { locked: variant !== 'nolock' }) },
      { name: 'HTTP', call: 'главный поток: два POST /getAndFlushMessages', run: (world, thread, variant) => serve(world, thread, { locked: variant !== 'nolock' }) }
    ],
    schedules: {
      ok: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1],
      nolock: [1, 0, 0, 1, 1, 1, 1, 1]
    },
    render: renderPostBox,
    verdict: world => {
      const got = world.replies.flatMap(reply => reply.items.map(item => item.text));
      if (got.join() === 'm1,m2') return { ok: true, text: `ответы: ${world.replies.map(reply => `[${names(reply.items)}]`).join(' + ')} — всё по разу и по порядку` };
      const lost = ['m1', 'm2'].filter(text => !got.includes(text));
      return { ok: false, text: lost.length ? `${lost.join(', ')} потерялось между deepcopy и очисткой` : `ответы: ${got.join(', ')}` };
    }
  },
  reconnect: {
    variants: { ok: 'решение', noretry: 'без try/except' },
    panes: [{ file: 'client', title: '_consume_messages', range: [74, 82] }],
    world: () => ({ stream: 'none', server: 'up', inbox: [], messages: [], missed: [] }),
    threads: [
      { name: 'читатель', call: '_consume_messages(stub, postbox)', run: (world, thread, variant) => reader(world, thread, { retry: variant !== 'noretry' }) },
      { name: 'сеть', call: 'сервер и другие клиенты', run: world => network(world) }
    ],
    schedules: {
      ok: [0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0],
      noretry: [0, 1, 0, 1, 0, 1, 1, 1]
    },
    render: renderReconnect,
    verdict: (world, race) => {
      if (race.threads[0].state === 'error') return { ok: false, text: `поток-читатель умер: ${names(world.missed)} — мимо буфера` };
      return { ok: true, text: `в буфере [${names(world.messages)}] · ${names(world.missed)} принят без подписки — по условию так можно` };
    }
  }
};

class Race {
  constructor(spec, variant) {
    this.world = spec.world(variant);
    this.threads = spec.threads.map((item, index) => new Thread(index, item));
    for (const thread of this.threads) thread.program = thread.spec.run(this.world, thread, variant);
    this.schedule = spec.schedules[variant];
    this.cursor = 0;
    this.steps = 0;
    this.last = null;
    this.finished = false;
  }

  ready(thread) {
    return thread.live() && !thread.blocked();
  }

  pick() {
    while (this.cursor < this.schedule.length) {
      const thread = this.threads[this.schedule[this.cursor++]];
      if (this.ready(thread)) return thread;
    }
    return this.threads.find(thread => this.ready(thread)) || null;
  }

  step() {
    const thread = this.finished ? null : this.pick();
    if (!thread) {
      this.finished = true;
      return null;
    }
    if (thread.state === 'ready') thread.state = 'run';
    const { value, done } = thread.program.next();
    if (done) thread.state = value.error ? 'error' : 'done';
    thread.lines = value.lines;
    this.steps += 1;
    this.last = { thread: thread.index, ...value };
    if (!this.threads.some(item => this.ready(item))) this.finished = true;
    return this.last;
  }
}

function chipRow(items, where, seen, keys, sent = 0) {
  const row = element('span', 'chips');
  if (!items.length) row.append(element('span', 'empty', 'пусто'));
  items.forEach((item, index) => {
    const node = element('span', `msg a${item.author}` + (index < sent ? ' sent' : ''));
    node.textContent = item.text;
    if (item.time !== undefined) node.append(element('small', '', String(item.time)));
    const key = `${where}:${item.text}`;
    if (seen && !seen.has(key)) node.classList.add('fresh');
    keys.add(key);
    row.append(node);
  });
  return row;
}

function lockBox(lock, threads) {
  const owner = lock.owner;
  const node = element('span', 'lockbox' + (owner ? ` held t${owner.index}` : ''), `${ICON(owner ? 'lock' : 'unlock')}<span></span>`);
  node.querySelector('span').textContent = owner ? `_lock · ${owner.name}` : '_lock свободен';
  const waiting = threads.filter(thread => thread.state === 'lock');
  if (owner && waiting.length) node.append(element('small', '', `ждут: ${waiting.map(thread => thread.name).join(', ')}`));
  return node;
}

function renderServer(world, race, seen, keys) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>MessengerServer</b>');
  head.append(lockBox(world.lock, race.threads));
  card.append(head);
  const last = element('div', 'var', '<span class="var-name">_last_time_ns = </span>');
  last.append(element('span', 'var-value', String(world.last)));
  card.append(last);
  const subs = element('div', 'subs');
  subs.append(element('div', 'var-name', '_subscribers'));
  for (const target of world.subs) {
    const row = element('div', 'sub');
    row.append(element('span', 'sub-name', `${target.name}<small>${target.who}</small>`));
    row.append(chipRow([...target.sent, ...target.items], target.name, seen, keys, target.sent.length));
    subs.append(row);
  }
  card.append(subs);
  return card;
}

function renderPostBox(world, race, seen, keys) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>PostBox</b>');
  head.append(lockBox(world.lock, race.threads));
  card.append(head);
  const box = element('div', 'sub', '<span class="sub-name">_messages</span>');
  box.append(chipRow(world.messages, 'box', seen, keys));
  const stream = element('div', 'sub', '<span class="sub-name">из потока</span>');
  stream.append(chipRow(world.incoming, 'stream', seen, keys));
  card.append(box, stream);
  for (const reply of world.replies) {
    const row = element('div', 'sub reply', `<span class="sub-name">ответ ${reply.number}</span>`);
    row.append(chipRow(reply.items, 'reply' + reply.number, seen, keys));
    card.append(row);
  }
  return card;
}

function renderReconnect(world, race, seen, keys) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>клиент</b>');
  const stream = { open: 'поток открыт', broken: 'поток оборван', none: 'потока нет' }[world.stream];
  head.append(element('span', `pill ${world.stream}`, stream), element('span', `pill ${world.server === 'up' ? 'open' : 'broken'}`, world.server === 'up' ? 'сервер работает' : 'сервер перезапускается'));
  card.append(head);
  const box = element('div', 'sub', '<span class="sub-name">_messages</span>');
  box.append(chipRow(world.messages, 'box', seen, keys));
  const missed = element('div', 'sub', '<span class="sub-name">без подписки</span>');
  missed.append(chipRow(world.missed, 'missed', seen, keys));
  card.append(box, missed);
  return card;
}

function transform(lines, change) {
  if (!change) return lines.map(([number, text]) => ({ number, text, mark: '' }));
  const inside = (ranges, number) => (ranges || []).some(([from, to]) => number >= from && number <= to);
  return lines.map(([number, text]) => ({
    number,
    text: inside(change.dedent, number) ? text.replace(/^ {4}/, '') : text,
    mark: (change.removed || []).includes(number) ? 'removed' : inside(change.moved, number) ? 'moved' : ''
  }));
}

class RaceLab {
  constructor(root, id, sources, emit) {
    this.root = root;
    this.id = id;
    this.spec = LABS[id];
    this.sources = sources;
    this.emit = emit;
    this.variant = 'ok';
    this.speed = 1;
    this.speedTimer = 0;
    this.playing = false;
    this.finished = false;
    this.now = 0;
    this.totals = new Map();
    this.seen = null;
    this.previousVars = new Map();
    this.build();
    this.seek(0);
  }

  build() {
    const head = element('div', 'lab-head');
    this.select = element('select');
    this.select.setAttribute('aria-label', 'Вариант кода');
    for (const [id, title] of Object.entries(this.spec.variants)) {
      const option = element('option');
      option.value = id;
      option.textContent = title;
      this.select.append(option);
    }
    this.playButton = element('button', 'chip-button play-button primary');
    this.playButton.type = 'button';
    this.stepButton = element('button', 'chip-button', `${ICON('step')}<span>Шаг</span>`);
    this.stepButton.type = 'button';
    this.resetButton = element('button', 'icon-button', ICON('reset'));
    this.resetButton.type = 'button';
    this.resetButton.setAttribute('aria-label', 'Заново');
    this.resetButton.title = 'Заново';
    this.speedBox = element('label', 'speed');
    this.speedBox.title = 'Скорость прогона';
    this.speedInput = element('input');
    this.speedInput.type = 'range';
    this.speedInput.min = '0';
    this.speedInput.max = '1';
    this.speedInput.step = '0.01';
    this.speedInput.value = '1';
    this.speedInput.setAttribute('aria-label', 'Скорость прогона');
    this.speedValue = element('output', '', '1.00');
    this.speedBox.append(this.speedInput, this.speedValue);
    head.append(this.select, this.speedBox, this.playButton, this.stepButton, this.resetButton);

    const stage = element('div', 'race');
    this.threadsBox = element('div', 'threads');
    this.worldBox = element('div', 'world-slot');
    stage.append(this.threadsBox, this.worldBox);

    this.caption = element('div', 'caption', '<span class="t"></span><span class="what" aria-live="polite"></span>');
    this.verdictBox = element('div', 'verdict');
    this.verdictBox.setAttribute('role', 'status');

    const panes = element('div', 'code-panes' + (this.spec.panes.length === 1 ? ' single' : ''));
    this.panes = this.spec.panes.map(spec => {
      const pane = element('div', 'code-pane');
      const title = element('div', 'code-title', `<b>${spec.title}</b>`);
      title.append(element('span', '', `${SOURCES[spec.file].split('/').pop()} · ${spec.range[0]}–${spec.range[1]}`));
      const pre = element('pre', 'code');
      pane.append(title, pre);
      panes.append(pane);
      return { spec, pre, rows: new Map() };
    });

    this.root.append(head, stage, this.caption, this.verdictBox, panes);

    this.playButton.addEventListener('click', () => this.control(this.playing ? 'pause' : 'play'));
    this.stepButton.addEventListener('click', () => this.control('step'));
    this.resetButton.addEventListener('click', () => this.control('reset'));
    this.select.addEventListener('change', () => this.control('reset', this.select.value));
    this.speedInput.addEventListener('input', () => {
      this.showSpeed(Number(this.speedInput.value));
      if (!this.speedTimer) this.speedTimer = setTimeout(() => this.shareSpeed(), 150);
    });
    this.speedInput.addEventListener('change', () => this.shareSpeed());
  }

  renderCode() {
    const change = CHANGES[`${this.id}:${this.variant}`];
    for (const pane of this.panes) {
      const source = this.sources[pane.spec.file];
      const [from, to] = pane.spec.range;
      const lines = transform(source.slice(from - 1, to).map((text, index) => [from + index, text]), change);
      const tags = TAGS[pane.spec.file];
      pane.rows = new Map();
      pane.pre.replaceChildren();
      for (const line of lines) {
        const row = element('span', 'ln' + (line.mark ? ' ' + line.mark : ''), `<span class="no"><span class="pcs"></span>${line.number}</span><span class="src">${highlight(line.text, PYTHON) || ' '}</span>`);
        if (line.mark) row.title = line.mark === 'removed' ? 'в этом варианте строки нет' : 'в этом варианте строка вынесена из with';
        if (tags[line.number] && !line.mark) row.append(element('span', 'tag', tags[line.number]));
        pane.rows.set(line.number, row);
        pane.pre.append(row);
      }
    }
  }

  total() {
    if (!this.totals.has(this.variant)) {
      const race = new Race(this.spec, this.variant);
      while (!race.finished) race.step();
      this.totals.set(this.variant, race.steps);
    }
    return this.totals.get(this.variant);
  }

  control(mode, variant = this.variant) {
    const restart = mode === 'reset' || variant !== this.variant || (this.finished && mode !== 'pause');
    const at = restart ? 0 : Math.floor(this.now * 1000) / 1000;
    const state = {
      t: 'lab',
      lab: this.id,
      mode,
      scenario: variant,
      seed: 1,
      at: mode === 'play' ? Math.max(at, Math.floor(at) + 0.999) : at,
      speed: this.speed
    };
    this.applyState(state);
    this.emit(state);
  }

  showSpeed(speed) {
    this.speed = Math.max(0, Math.min(1, Math.round(speed * 100) / 100));
    this.speedInput.value = String(this.speed);
    this.speedValue.textContent = this.speed.toFixed(2);
  }

  shareSpeed() {
    clearTimeout(this.speedTimer);
    this.speedTimer = 0;
    const mode = this.playing ? 'play' : 'pause';
    this.emit({ t: 'lab', lab: this.id, mode, scenario: this.variant, seed: 1, at: Math.floor(this.now * 1000) / 1000, speed: this.speed });
  }

  applyState(state, elapsed = 0) {
    const variant = Object.hasOwn(this.spec.variants, state.scenario) ? state.scenario : 'ok';
    const redraw = variant !== this.variant || !this.panes[0].rows.size;
    this.variant = variant;
    this.select.value = variant;
    if (redraw) this.renderCode();
    this.showSpeed(typeof state.speed === 'number' ? state.speed : 1);
    if (state.mode === 'step') {
      const target = Math.floor(state.at) + 1;
      if (!redraw && !this.race.finished && this.race.steps === target - 1) this.advance();
      else this.seek(target);
      return;
    }
    this.seek(state.mode === 'play' ? state.at + elapsed * this.speed / STEP_MS : state.at);
    if (state.mode === 'play' && !this.finished) this.play();
  }

  seek(at) {
    if (!this.panes[0].rows.size) this.renderCode();
    this.race = new Race(this.spec, this.variant);
    this.playing = false;
    this.finished = false;
    const target = Math.floor(Math.max(0, at));
    while (this.race.steps < target && !this.race.finished) this.race.step();
    this.now = Math.min(Math.max(0, at), this.race.steps + 0.999);
    this.verdictBox.className = 'verdict';
    this.verdictBox.replaceChildren();
    this.seen = null;
    this.previousVars = new Map();
    this.render();
    if (this.race.finished) this.finish();
    this.updateButtons();
  }

  advance() {
    this.playing = false;
    this.race.step();
    this.now = this.race.steps;
    this.render();
    if (this.race.finished) this.finish();
    this.updateButtons();
  }

  play() {
    this.playing = true;
    this.updateButtons();
  }

  updateButtons() {
    const label = this.playing ? 'Пауза' : this.finished ? 'Ещё раз' : this.race.steps > 0 ? 'Дальше' : 'Запустить';
    this.playButton.innerHTML = `${ICON(this.playing ? 'pause' : 'play')}<span>${label}</span>`;
  }

  tick(ms) {
    if (!this.playing) return;
    this.now += ms * this.speed / STEP_MS;
    let moved = false;
    while (this.race.steps < Math.floor(this.now) && !this.race.finished) {
      this.race.step();
      moved = true;
    }
    if (moved) this.render();
    if (this.race.finished) this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    const verdict = this.spec.verdict(this.race.world, this.race);
    this.verdictBox.className = 'verdict shown' + (verdict.ok ? '' : ' bad');
    this.verdictBox.innerHTML = `${ICON(verdict.ok ? 'check' : 'x')}<span></span>`;
    this.verdictBox.querySelector('span').textContent = verdict.text;
    this.updateButtons();
  }

  render() {
    const keys = new Set();
    this.renderThreads();
    this.worldBox.replaceChildren(this.spec.render(this.race.world, this.race, this.seen, keys));
    this.seen = keys;
    this.markCode();
    const last = this.race.last;
    this.caption.querySelector('.t').textContent = `шаг ${this.race.steps}/${this.total()}`;
    const what = this.caption.querySelector('.what');
    what.replaceChildren();
    if (last) {
      const who = element('span', `who t${last.thread}`, this.race.threads[last.thread].name);
      what.append(who, document.createTextNode(' ' + last.note));
    } else {
      what.textContent = 'потоки ещё не начали';
    }
  }

  renderThreads() {
    const active = this.race.last ? this.race.last.thread : -1;
    this.threadsBox.replaceChildren(...this.race.threads.map(thread => {
      const card = element('div', `thread t${thread.index} ${thread.state}` + (thread.index === active ? ' active' : ''));
      const head = element('div', 'thread-head');
      head.append(element('span', 'dot'), element('b', '', thread.name));
      const state = STATES[thread.state] || (thread.lines.length ? `строка ${thread.lines[thread.lines.length - 1]}` : 'идёт');
      head.append(element('span', 'thread-state', state));
      card.append(head);
      const call = element('code', 'thread-call');
      call.textContent = thread.spec.call;
      card.append(call);
      for (const [name, value] of thread.vars) {
        const row = element('div', 'var');
        row.append(element('span', 'var-name', name + ' = '));
        const span = element('span', 'var-value');
        span.textContent = value;
        const key = thread.index + name;
        if (this.previousVars.size && this.previousVars.get(key) !== value) span.classList.add('changed');
        this.previousVars.set(key, value);
        row.append(span);
        card.append(row);
      }
      return card;
    }));
  }

  markCode() {
    const active = this.race.last ? this.race.last.thread : -1;
    for (const pane of this.panes) {
      for (const row of pane.rows.values()) {
        row.classList.remove('hit', 't0', 't1', 't2');
        row.querySelector('.pcs').replaceChildren();
      }
      for (const thread of this.race.threads) {
        if (!thread.live() && thread.index !== active) continue;
        thread.lines.forEach((number, index) => {
          const row = pane.rows.get(number);
          if (!row) return;
          if (thread.index === active) row.classList.add('hit', `t${thread.index}`);
          if (index === thread.lines.length - 1) row.querySelector('.pcs').append(element('i', `pc t${thread.index}`));
        });
      }
    }
  }
}

export async function mountRaces(emit) {
  const roots = Array.from(document.querySelectorAll('[data-race]'));
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([file, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(url);
    return [file, (await response.text()).replace(/\r/g, '').split('\n')];
  }));
  const sources = Object.fromEntries(entries);
  const labs = roots.map(root => new RaceLab(root, root.dataset.race, sources, emit));
  let last = performance.now();
  const frame = now => {
    const ms = now - last;
    last = now;
    for (const lab of labs) lab.tick(ms);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    apply(state, elapsed) {
      const lab = labs.find(item => item.id === state.lab);
      if (lab) lab.applyState(state, elapsed);
    },
    restore(states, now) {
      for (const lab of labs) {
        const state = states[lab.id];
        if (state) lab.applyState(state, Math.max(0, now - state.stamp));
        else lab.applyState({ lab: lab.id, mode: 'reset', scenario: 'ok', seed: 1, at: 0, speed: 1 });
      }
    }
  };
}
