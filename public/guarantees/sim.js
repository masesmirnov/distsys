import { ICON, element, highlight } from './code.js';

const RESEND_DELAY = 4.0;
const UNIT_MS = 780;
const LOST_AT = 0.5;
const TEXTS = ['distributed', 'systems', 'need', 'some', 'guarantees'];
const GIVE_TIMES = [0, 0.8, 1.6, 2.4, 3.2];
const TIME_LIMIT = 90;

const STORY = {
  'DATA:1:1': { drop: true },
  'DATA:2:1': { delays: [2.2] },
  'DATA:3:1': { delays: [1, 2.4] },
  'ACK:2:1': { drop: true }
};

const SCENARIOS = {
  story: {
    title: 'Потеря, дубль, опоздание',
    fate: (message, attempt) => STORY[`${message.type}:${message.key}:${attempt}`] || { delays: [1] }
  },
  ideal: {
    title: 'Идеальная сеть',
    fate: () => ({ delays: [1] })
  },
  chaos: {
    title: 'Случайная сеть',
    random: true,
    fate: (message, attempt, random) => {
      if (random() < 0.3) return { drop: true };
      const delay = () => Math.round((1 + 2 * random()) * 10) / 10;
      return random() < 0.3 ? { delays: [delay(), delay()] } : { delays: [delay()] };
    }
  }
};

const TAGS = {
  naive: { 3: 'шлём как есть', 7: 'отдаём всё' },
  real: {
    13: 'следующий номер',
    14: 'ждут ACK',
    19: 'копия для повтора',
    21: 'будильник = номер',
    28: 'ещё ждём?',
    30: 'ACK пришёл',
    35: 'страховка',
    37: 'тот же номер',
    38: 'снова будильник',
    46: 'следующий номер',
    49: 'один раз',
    65: 'максимум',
    66: 'дырки ниже',
    76: 'новее всех',
    77: 'новые дырки',
    81: 'бинпоиск',
    83: 'дырка закрыта',
    107: 'отдаём всё',
    108: 'ACK на каждую копию',
    123: 'максимум',
    124: 'дырки ниже',
    134: 'ACK даже на дубль',
    136: 'новые дырки',
    140: 'бинпоиск',
    142: 'дырка закрыта',
    158: 'кого ждём',
    159: 'забежавшие вперёд',
    170: 'дубль',
    172: 'его очередь',
    175: 'разгружаем буфер',
    179: 'в буфер'
  }
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bisectLeft(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const list = values => values.map(value => '#' + value).join(', ');

class NaiveSender {
  view() { return { stateless: true }; }
  onLocalMessage(text, ctx) {
    ctx.send({ type: 'DATA', text });
    return { lines: [2, 3], note: `«${text}» уходит как есть` };
  }
  onMessage() { return null; }
  onTimer() { return null; }
}

class NaiveReceiver {
  view() { return { stateless: true }; }
  onMessage(msg, ctx) {
    ctx.deliver(msg.text);
    return { lines: [6, 7], note: `«${msg.text}» → R, без проверок` };
  }
}

class AmoSender {
  constructor() { this.nextSeq = 0; }
  view() { return { vars: [['_next_seq', String(this.nextSeq)]] }; }
  onLocalMessage(text, ctx) {
    const seq = this.nextSeq;
    ctx.send({ type: 'DATA', seq, text });
    this.nextSeq += 1;
    return { lines: [48, 49, 50], note: `«${text}» → DATA #${seq}, один раз` };
  }
  onMessage() { return null; }
  onTimer() { return null; }
}

class ReliableSender {
  constructor() {
    this.nextSeq = 0;
    this.pending = new Map();
  }
  view() {
    return { vars: [['_next_seq', String(this.nextSeq)]], pending: Array.from(this.pending, ([seq, text]) => ({ seq, text })) };
  }
  onLocalMessage(text, ctx) {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.pending.set(seq, text);
    ctx.send({ type: 'DATA', seq, text });
    ctx.setTimer(String(seq), RESEND_DELAY);
    return { lines: [16, 17, 18, 19, 20, 21], note: `«${text}» → #${seq}: в <code>_pending</code>, DATA #${seq}, будильник` };
  }
  onMessage(msg, ctx) {
    const seq = msg.seq;
    if (this.pending.has(seq)) {
      this.pending.delete(seq);
      ctx.cancelTimer(String(seq));
      return { lines: [26, 27, 28, 29, 30], note: `ACK #${seq}: вычеркнули, будильник выключен` };
    }
    return { lines: [26, 27, 28], note: `ACK #${seq}: уже не ждём` };
  }
  onTimer(name, ctx) {
    const seq = Number(name);
    const text = this.pending.get(seq);
    if (text === undefined) return { lines: [32, 33, 34, 35, 36], note: `будильник #${seq}: письма уже нет` };
    ctx.send({ type: 'DATA', seq, text });
    ctx.setTimer(name, RESEND_DELAY);
    return { lines: [32, 33, 34, 35, 37, 38], note: `будильник #${seq}: ACK нет → повтор DATA #${seq}` };
  }
}

class HolesReceiver {
  constructor(acks, first) {
    this.acks = acks;
    this.first = first;
    this.maxSeq = -1;
    this.missing = [];
  }
  view() {
    const tape = [];
    for (let seq = 0; seq <= this.maxSeq; seq++) tape.push({ seq, state: this.missing.includes(seq) ? 'hole' : 'done' });
    return {
      vars: [['_max_seq', String(this.maxSeq)], ['_missing', `array('i', [${this.missing.join(', ')}])`]],
      tape
    };
  }
  onMessage(msg, ctx) {
    const seq = msg.seq;
    const at = this.first;
    const lines = [at, at + 1];
    if (this.acks) {
      ctx.send({ type: 'ACK', seq });
      lines.push(at + 2);
    }
    const base = this.acks ? at + 3 : at + 2;
    lines.push(base);
    const ack = this.acks ? ' + ACK' : '';
    if (seq > this.maxSeq) {
      const added = [];
      for (let value = this.maxSeq + 1; value < seq; value++) added.push(value);
      const previous = this.maxSeq;
      this.missing.push(...added);
      this.maxSeq = seq;
      ctx.deliver(msg.text);
      lines.push(base + 1, base + 2, base + 3, base + 4);
      const holes = added.length ? `дырки ${list(added)}` : 'без дырок';
      return { lines, note: `#${seq} > max ${previous} → ${holes}, отдаём${ack}` };
    }
    const i = bisectLeft(this.missing, seq);
    lines.push(base + 5, base + 6);
    if (i < this.missing.length && this.missing[i] === seq) {
      this.missing.splice(i, 1);
      ctx.deliver(msg.text);
      lines.push(base + 7, base + 8);
      return { lines, note: `#${seq} в дырках → отдаём, дырка закрыта${ack}` };
    }
    return { lines, note: `#${seq} уже было → ${this.acks ? 'только ACK' : 'выбросили'}` };
  }
}

class AloReceiver {
  constructor() { this.seen = new Set(); }
  view() { return { stateless: true }; }
  onMessage(msg, ctx) {
    ctx.deliver(msg.text);
    ctx.send({ type: 'ACK', seq: msg.seq });
    const again = this.seen.has(msg.seq);
    this.seen.add(msg.seq);
    return { lines: [106, 107, 108], note: `отдаём «${msg.text}»${again ? ' повторно' : ''} + ACK #${msg.seq}` };
  }
}

class EooReceiver {
  constructor() {
    this.expected = 0;
    this.buffer = new Map();
  }
  view() {
    const top = Math.max(this.expected, ...this.buffer.keys());
    const tape = [];
    for (let seq = 0; seq <= top; seq++) {
      if (seq < this.expected) tape.push({ seq, state: 'done' });
      else if (this.buffer.has(seq)) tape.push({ seq, state: 'buffered' });
      else tape.push({ seq, state: seq === this.expected ? 'expected' : 'empty' });
    }
    const buffer = Array.from(this.buffer, ([seq, text]) => `${seq}: '${text}'`).join(', ');
    return { vars: [['_expected', String(this.expected)], ['_buffer', `{${buffer}}`]], tape };
  }
  onMessage(msg, ctx) {
    const seq = msg.seq;
    ctx.send({ type: 'ACK', seq });
    const lines = [167, 168, 169, 170];
    if (seq < this.expected || this.buffer.has(seq)) {
      lines.push(171);
      return { lines, note: `#${seq} ${seq < this.expected ? 'уже выдан' : 'уже в буфере'} → только ACK` };
    }
    lines.push(172);
    if (seq === this.expected) {
      ctx.deliver(msg.text);
      this.expected += 1;
      lines.push(173, 174, 175);
      const drained = [];
      while (this.buffer.has(this.expected)) {
        ctx.deliver(this.buffer.get(this.expected), this.expected);
        this.buffer.delete(this.expected);
        drained.push(this.expected);
        this.expected += 1;
        lines.push(176, 177);
      }
      const rest = drained.length ? ` + из буфера ${list(drained)}` : '';
      return { lines, note: `#${seq} — его очередь → отдаём${rest}, ACK` };
    }
    this.buffer.set(seq, msg.text);
    lines.push(179);
    return { lines, note: `#${seq}, а ждём #${this.expected} → в буфер, ACK` };
  }
}

const NAIVE_CODE = [
  'class Sender(Process):',
  '    def on_local_message(self, msg, ctx):',
  '        ctx.send(Message("DATA", {"text": msg["text"]}), "receiver")',
  '',
  'class Receiver(Process):',
  '    def on_message(self, msg, sender, ctx):',
  '        ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))'
];

const RELIABLE = { title: '_ReliableSender', range: [9, 38] };

const SPECS = {
  naive: {
    sender: () => new NaiveSender(),
    receiver: () => new NaiveReceiver(),
    acks: false,
    numbered: false,
    senderCode: { title: 'Sender', note: 'упрощённо', naive: [1, 3] },
    receiverCode: { title: 'Receiver', note: 'упрощённо', naive: [5, 7] },
    verdict: 'naive'
  },
  amo: {
    sender: () => new AmoSender(),
    receiver: () => new HolesReceiver(false, 74),
    acks: false,
    numbered: true,
    senderCode: { title: 'AtMostOnceSender', range: [42, 59] },
    receiverCode: { title: 'AtMostOnceReceiver', range: [62, 87] },
    verdict: 'amo'
  },
  alo: {
    sender: () => new ReliableSender(),
    receiver: () => new AloReceiver(),
    acks: true,
    numbered: true,
    senderCode: { ...RELIABLE, note: 'AtLeastOnceSender(_ReliableSender)' },
    receiverCode: { title: 'AtLeastOnceReceiver', range: [96, 111] },
    verdict: 'alo'
  },
  eo: {
    sender: () => new ReliableSender(),
    receiver: () => new HolesReceiver(true, 132),
    acks: true,
    numbered: true,
    senderCode: { ...RELIABLE, note: 'ExactlyOnceSender(_ReliableSender)' },
    receiverCode: { title: 'ExactlyOnceReceiver', range: [120, 146] },
    verdict: 'eo'
  },
  eoo: {
    sender: () => new ReliableSender(),
    receiver: () => new EooReceiver(),
    acks: true,
    numbered: true,
    senderCode: { ...RELIABLE, note: 'ExactlyOnceOrderedSender(_ReliableSender)' },
    receiverCode: { title: 'ExactlyOnceOrderedReceiver', range: [155, 182] },
    verdict: 'eoo'
  }
};

class Simulation {
  constructor(spec, scenario, seed) {
    this.spec = spec;
    this.scenario = scenario;
    this.random = scenario.random ? seeded(seed) : null;
    this.queue = [];
    this.order = 0;
    this.time = 0;
    this.sender = spec.sender();
    this.receiver = spec.receiver();
    this.envelopes = [];
    this.delivered = [];
    this.given = new Set();
    this.timers = new Map();
    this.attempts = new Map();
    this.nextEnvelope = 0;
    this.lastVisual = 0;
    this.sent = 0;
    TEXTS.forEach((text, index) => this.push(GIVE_TIMES[index], { kind: 'give', index }));
  }

  push(time, event) {
    event.time = Math.round(time * 1000) / 1000;
    event.order = this.order++;
    this.queue.push(event);
    this.queue.sort((a, b) => a.time - b.time || a.order - b.order);
    return event;
  }

  remove(event) {
    const index = this.queue.indexOf(event);
    if (index >= 0) this.queue.splice(index, 1);
  }

  nextTime() {
    return this.queue.length ? this.queue[0].time : null;
  }

  done() {
    return !this.queue.length || this.time > TIME_LIMIT;
  }

  context(current) {
    return {
      send: message => this.transmit(message, current),
      deliver: (text, seq) => {
        const origin = seq !== undefined ? seq : current.origin;
        this.delivered.push({ text, origin, seq: this.spec.numbered ? origin : null, time: this.time });
      },
      setTimer: (name, delay) => {
        const previous = this.timers.get(name);
        if (previous) this.remove(previous.event);
        const event = this.push(this.time + delay, { kind: 'timer', name });
        this.timers.set(name, { event, from: this.time, at: event.time });
      },
      cancelTimer: name => {
        const timer = this.timers.get(name);
        if (!timer) return;
        this.remove(timer.event);
        this.timers.delete(name);
      }
    };
  }

  transmit(message, current) {
    const from = message.type === 'ACK' ? 'receiver' : 'sender';
    const origin = message.seq !== undefined ? message.seq : current.origin;
    const attemptKey = `${message.type}:${origin}`;
    const attempt = (this.attempts.get(attemptKey) || 0) + 1;
    this.attempts.set(attemptKey, attempt);
    this.sent += 1;
    const fate = this.scenario.fate({ ...message, key: origin }, attempt, this.random);
    const base = {
      type: message.type,
      seq: message.seq,
      text: message.text,
      origin,
      from,
      to: from === 'sender' ? 'receiver' : 'sender',
      sent: this.time,
      retry: message.type === 'DATA' && attempt > 1
    };
    if (fate.drop) {
      const envelope = { ...base, id: this.nextEnvelope++, lost: true, dies: this.time + LOST_AT, arrive: this.time + 1 };
      this.envelopes.push(envelope);
      this.push(envelope.dies, { kind: 'lost', envelope });
      this.lastVisual = Math.max(this.lastVisual, envelope.dies + 0.6);
      return;
    }
    fate.delays.forEach((delay, copy) => {
      const envelope = { ...base, id: this.nextEnvelope++, copy: copy > 0, arrive: this.time + delay };
      this.envelopes.push(envelope);
      this.push(envelope.arrive, { kind: 'arrive', envelope });
      this.lastVisual = Math.max(this.lastVisual, envelope.arrive + 0.3);
    });
  }

  step() {
    const event = this.queue.shift();
    if (!event) return null;
    this.time = event.time;
    if (event.kind === 'give') {
      this.given.add(event.index);
      const result = this.sender.onLocalMessage(TEXTS[event.index], this.context({ origin: event.index }));
      return { actor: 'sender', ...result };
    }
    if (event.kind === 'timer') {
      this.timers.delete(event.name);
      return { actor: 'sender', ...this.sender.onTimer(event.name, this.context({})) };
    }
    if (event.kind === 'lost') {
      const envelope = event.envelope;
      const what = this.spec.numbered ? `${envelope.type} #${envelope.seq}` : `«${envelope.text}»`;
      return { actor: 'network', lines: [], note: `сеть потеряла ${what}` };
    }
    const envelope = event.envelope;
    envelope.arrived = true;
    const message = { type: envelope.type, seq: envelope.seq, text: envelope.text };
    const current = { origin: envelope.origin };
    if (envelope.to === 'receiver') return { actor: 'receiver', ...this.receiver.onMessage(message, this.context(current)) };
    const result = this.sender.onMessage(message, this.context(current));
    return result ? { actor: 'sender', ...result } : null;
  }

  verdict() {
    const counts = TEXTS.map(() => 0);
    for (const item of this.delivered) counts[item.origin] += 1;
    const lost = counts.filter(count => count === 0).length;
    const repeats = counts.reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    const origins = this.delivered.map(item => item.origin);
    const ordered = origins.every((origin, index) => index === 0 || origin > origins[index - 1]);
    const stats = `в сети ${this.sent} · потеряно ${lost} · повторов ${repeats}`;
    const broken = { ok: false, text: `Нарушено · ${stats}` };
    switch (this.spec.verdict) {
      case 'naive':
        return lost || repeats || !ordered ? { ok: false, text: `Гарантий нет · ${stats}${ordered ? '' : ' · порядок сбит'}` } : { ok: true, text: stats };
      case 'amo':
        return repeats ? broken : { ok: true, text: `Повторов нет · ${stats}` };
      case 'alo':
        return lost ? broken : { ok: true, text: `Дошло всё · ${stats}` };
      case 'eo':
        return lost || repeats ? broken : { ok: true, text: `Ровно один раз · ${stats}` };
      default:
        return lost || repeats || !ordered ? broken : { ok: true, text: `Ровно один раз по порядку · ${stats}` };
    }
  }
}

const PYTHON = {
  keywords: new Set(['class', 'def', 'if', 'else', 'return', 'while', 'pass', 'in', 'not', 'and', 'or', 'is', 'None', 'from', 'import', 'del', 'self']),
  builtins: new Set(['range', 'len', 'int', 'str', 'array', 'bisect_left', 'Message', 'Process', 'Context']),
  definers: new Set(['def', 'class'])
};

class Lab {
  constructor(root, kind, source, emit) {
    this.root = root;
    this.kind = kind;
    this.spec = SPECS[kind];
    this.source = source;
    this.emit = emit;
    this.scenarioId = 'story';
    this.seed = 1;
    this.speed = 1;
    this.speedTimer = 0;
    this.playing = false;
    this.stepping = false;
    this.visible = false;
    this.finished = false;
    this.envelopeNodes = new Map();
    this.build();
    this.seek(0);
  }

  build() {
    const head = element('div', 'lab-head');
    this.select = element('select');
    this.select.setAttribute('aria-label', 'Сеть');
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      const option = element('option');
      option.value = id;
      option.textContent = scenario.title;
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

    const stage = element('div', 'stage');
    const users = element('div', 'users');
    this.sNotes = element('div', 'user s', '<span class="user-label">S</span>');
    this.rNotes = element('div', 'user r', '<span class="user-label">R</span>');
    users.append(this.sNotes, this.rNotes);
    const subtitle = code => (this.spec.numbered ? code.title : '');
    this.senderBox = element('div', 'proc', `<div class="proc-name">Sender<small>${subtitle(this.spec.senderCode)}</small></div><div class="vars"></div>`);
    this.receiverBox = element('div', 'proc', `<div class="proc-name">Receiver<small>${subtitle(this.spec.receiverCode)}</small></div><div class="vars"></div>`);
    this.net = element('div', 'net');
    const dataLane = element('div', 'lane data', '<span class="lane-label">DATA →</span>');
    this.net.append(dataLane);
    if (this.spec.acks) this.net.append(element('div', 'lane ack', '<span class="lane-label">← ACK</span>'));
    else dataLane.style.top = '50%';
    this.clock = element('div', 'clock', 't = 0.0');
    this.net.append(this.clock);
    stage.append(users, this.senderBox, this.net, this.receiverBox);

    this.caption = element('div', 'caption', '<span class="t">t = 0.0</span><span class="what"></span>');
    this.verdictBox = element('div', 'verdict');

    const panes = element('div', 'code-panes');
    this.senderCode = this.codePane(this.spec.senderCode);
    this.receiverCode = this.codePane(this.spec.receiverCode);
    panes.append(this.senderCode.pane, this.receiverCode.pane);

    this.root.append(head, stage, this.caption, this.verdictBox, panes);

    this.playButton.addEventListener('click', () => this.control(this.playing && !this.stepping ? 'pause' : 'play'));
    this.stepButton.addEventListener('click', () => this.control('step'));
    this.resetButton.addEventListener('click', () => this.control('reset'));
    this.select.addEventListener('change', () => this.control('play', this.select.value));
    this.speedInput.addEventListener('input', () => {
      this.showSpeed(Number(this.speedInput.value));
      if (!this.speedTimer) this.speedTimer = setTimeout(() => this.shareSpeed(), 150);
    });
    this.speedInput.addEventListener('change', () => this.shareSpeed());
  }

  codePane(spec) {
    const pane = element('div', 'code-pane');
    const title = element('div', 'code-title', `<b>${spec.title}</b>`);
    const note = element('span', '', spec.note || `строки ${spec.range[0]}–${spec.range[1]}`);
    title.append(note);
    pane.append(title);
    const pre = element('pre', 'code');
    const rows = new Map();
    const tags = spec.naive ? TAGS.naive : TAGS.real;
    const lines = spec.naive
      ? NAIVE_CODE.slice(spec.naive[0] - 1, spec.naive[1]).map((text, index) => [spec.naive[0] + index, text])
      : this.source.slice(spec.range[0] - 1, spec.range[1]).map((text, index) => [spec.range[0] + index, text]);
    const idle = text => /^\s*pass\s*$/.test(text || '');
    lines.forEach(([number, text], index) => {
      const row = element('span', 'ln', `<span class="no">${number}</span><span class="src">${highlight(text, PYTHON) || ' '}</span>`);
      if (tags[number]) row.append(element('span', 'tag', tags[number]));
      const next = lines[index + 1];
      if (idle(text) || (/^\s+def /.test(text) && next && idle(next[1]))) row.classList.add('dim');
      rows.set(number, row);
      pre.append(row);
    });
    pane.append(pre);
    return { pane, rows };
  }

  control(mode, scenario = this.scenarioId) {
    const restart = mode === 'reset' || scenario !== this.scenarioId || (this.finished && mode !== 'pause');
    const state = {
      t: 'lab',
      lab: this.kind,
      mode,
      scenario,
      seed: restart ? (SCENARIOS[scenario].random ? Math.floor(Math.random() * 2 ** 31) : 1) : this.seed,
      at: restart ? 0 : Math.round(this.now * 1000) / 1000,
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
    const mode = this.finished ? 'pause' : this.playing ? (this.stepping ? 'step' : 'play') : 'pause';
    this.emit({ t: 'lab', lab: this.kind, mode, scenario: this.scenarioId, seed: this.seed, at: Math.round(this.now * 1000) / 1000, speed: this.speed });
  }

  applyState(state, elapsed = 0) {
    this.scenarioId = state.scenario;
    this.select.value = state.scenario;
    this.seed = state.seed;
    this.showSpeed(typeof state.speed === 'number' ? state.speed : 1);
    this.seek(state.mode === 'play' ? state.at + elapsed * this.speed / UNIT_MS : state.at);
    if (this.finished) return;
    if (state.mode === 'play') this.play();
    else if (state.mode === 'step') this.step();
  }

  seek(time) {
    this.sim = new Simulation(this.spec, SCENARIOS[this.scenarioId], this.seed);
    this.playing = false;
    this.stepping = false;
    this.finished = false;
    this.envelopeNodes.forEach(node => node.remove());
    this.envelopeNodes = new Map();
    this.verdictBox.className = 'verdict';
    this.verdictBox.replaceChildren();
    this.previousVars = new Map();
    this.pendingSeen = null;
    let last = null;
    for (;;) {
      const next = this.sim.nextTime();
      if (next === null || next > time || this.sim.time > TIME_LIMIT) break;
      last = this.sim.step() || last;
    }
    this.now = Math.max(0, time);
    this.deliveredShown = this.sim.delivered.length;
    this.renderNotes();
    this.renderState(true);
    this.mark(last);
    for (const node of [this.senderBox, this.receiverBox]) node.classList.remove('active');
    const intro = SCENARIOS[this.scenarioId].random ? `seed ${this.seed} · потери 30% · дубли 30% · задержка 1–3` : '—';
    if (last) this.setCaption(this.sim.time, last.note);
    else this.setCaption(0, intro);
    if (this.sim.done() && this.now >= this.sim.lastVisual) this.finish();
    this.updateButtons();
    this.draw();
  }

  play() {
    this.playing = true;
    this.stepping = false;
    this.updateButtons();
  }

  step() {
    this.playing = true;
    this.stepping = true;
    this.updateButtons();
  }

  updateButtons() {
    const running = this.playing && !this.stepping;
    const label = running ? 'Пауза' : this.finished ? 'Ещё раз' : this.now > 0 ? 'Дальше' : 'Запустить';
    this.playButton.innerHTML = `${ICON(running ? 'pause' : 'play')}<span>${label}</span>`;
  }

  tick(ms) {
    if (!this.playing) return;
    let target = this.now + ms * (this.stepping ? 1 : this.speed) / UNIT_MS;
    for (;;) {
      const next = this.sim.nextTime();
      if (next === null || next > target || this.sim.time > TIME_LIMIT) break;
      this.now = next;
      const result = this.sim.step();
      if (result) this.apply(result);
      if (this.stepping && result && !this.sim.done()) {
        this.playing = false;
        this.stepping = false;
        target = this.now;
        this.updateButtons();
        break;
      }
    }
    if (this.playing) this.now = target;
    if (this.sim.done() && this.now >= this.sim.lastVisual) this.finish();
  }

  apply(result) {
    const box = result.actor === 'sender' ? this.senderBox : result.actor === 'receiver' ? this.receiverBox : null;
    for (const node of [this.senderBox, this.receiverBox]) node.classList.toggle('active', node === box);
    this.mark(result);
    this.setCaption(this.sim.time, result.note);
    this.renderNotes();
    this.renderState(false);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    this.stepping = false;
    for (const node of [this.senderBox, this.receiverBox]) node.classList.remove('active');
    const verdict = this.sim.verdict();
    this.verdictBox.className = 'verdict shown' + (verdict.ok ? '' : ' bad');
    this.verdictBox.innerHTML = `${ICON(verdict.ok ? 'check' : 'x')}<span></span>`;
    this.verdictBox.querySelector('span').textContent = verdict.text;
    this.renderNotes(true);
    this.updateButtons();
  }

  mark(result) {
    for (const code of [this.senderCode, this.receiverCode]) {
      for (const row of code.rows.values()) row.classList.remove('hit');
    }
    if (!result || !result.lines.length) return;
    const code = result.actor === 'sender' ? this.senderCode : this.receiverCode;
    for (const line of result.lines) {
      const row = code.rows.get(line);
      if (row) row.classList.add('hit');
    }
  }

  setCaption(time, note) {
    this.caption.querySelector('.t').textContent = `t = ${time.toFixed(1)}`;
    this.caption.querySelector('.what').innerHTML = note;
  }

  renderNotes(final) {
    const sNodes = TEXTS.map((text, index) => {
      const note = element('span', 'note');
      note.textContent = text;
      if (this.sim.given.has(index)) note.classList.add('given');
      if (final && !this.sim.delivered.some(item => item.origin === index)) note.classList.add('lost');
      return note;
    });
    this.sNotes.replaceChildren(this.sNotes.firstChild, ...sNodes);
    const seen = new Map();
    const rNodes = this.sim.delivered.map((item, index) => {
      const note = element('span', 'note');
      if (item.seq !== null) note.append(element('span', 'seq', '#' + item.seq));
      note.append(document.createTextNode(item.text));
      const times = (seen.get(item.origin) || 0) + 1;
      seen.set(item.origin, times);
      if (times > 1) note.classList.add('dup');
      if (index >= this.deliveredShown) note.classList.add('fresh');
      return note;
    });
    this.deliveredShown = this.sim.delivered.length;
    this.rNotes.replaceChildren(this.rNotes.firstChild, ...rNodes);
  }

  renderState(initial) {
    this.renderProcess(this.senderBox, this.sim.sender.view(), 'sender', initial);
    this.renderProcess(this.receiverBox, this.sim.receiver.view(), 'receiver', initial);
  }

  renderProcess(box, view, side, initial) {
    const vars = box.querySelector('.vars');
    vars.replaceChildren();
    if (view.stateless) {
      vars.append(element('div', 'stateless', '∅<small>ничего не хранит</small>'));
    }
    for (const [name, value] of view.vars || []) {
      const row = element('div', 'var');
      row.append(element('span', 'var-name', name + ' = '));
      const span = element('span', 'var-value');
      span.textContent = value;
      const key = side + name;
      if (!initial && this.previousVars.get(key) !== value) span.classList.add('changed');
      this.previousVars.set(key, value);
      row.append(span);
      vars.append(row);
    }
    if (view.pending) {
      const wrap = element('div', 'var');
      wrap.append(element('span', 'var-name', '_pending'));
      const rows = element('div', 'pending');
      if (!view.pending.length) rows.append(element('span', 'var-value', '{}'));
      const known = this.pendingSeen || new Set();
      this.pendingSeen = new Set(view.pending.map(item => item.seq));
      for (const item of view.pending) {
        const row = element('div', 'pending-row' + (initial || known.has(item.seq) ? '' : ' fresh'));
        row.dataset.seq = item.seq;
        row.innerHTML = `<span>#${item.seq}</span><span class="txt"></span><svg class="timer" viewBox="0 0 16 16"><circle class="track" cx="8" cy="8" r="6"/><circle class="left" cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="100 100"/></svg>`;
        row.querySelector('.txt').textContent = item.text;
        rows.append(row);
      }
      wrap.append(rows);
      vars.append(wrap);
    }
    if (view.tape) {
      const tape = element('div', 'tape');
      for (const cell of view.tape) {
        const node = element('span', 'cell ' + cell.state);
        node.textContent = cell.seq;
        node.title = { done: 'доставлено', hole: 'дырка', buffered: 'в буфере', expected: 'ждём', empty: 'ещё не было' }[cell.state];
        tape.append(node);
      }
      vars.append(tape);
    }
  }

  draw() {
    this.clock.textContent = `t = ${this.now.toFixed(1)}`;
    this.drawTimers();
    const width = this.net.clientWidth;
    const height = this.net.clientHeight;
    const live = new Set();
    for (const envelope of this.sim.envelopes) {
      if (envelope.sent > this.now) continue;
      const end = envelope.lost ? envelope.dies + 0.6 : envelope.arrive + 0.3;
      if (this.now > end) continue;
      live.add(envelope.id);
      let node = this.envelopeNodes.get(envelope.id);
      if (!node) {
        node = element('div', 'env' + (envelope.type === 'ACK' ? ' ack' : '') + (envelope.copy ? ' copy' : ''));
        const label = this.spec.numbered ? `${envelope.type} #${envelope.seq}` : envelope.text;
        node.textContent = label + (envelope.retry ? ' ↻' : '');
        this.net.append(node);
        this.envelopeNodes.set(envelope.id, node);
      }
      const span = envelope.lost ? 1 : envelope.arrive - envelope.sent;
      let progress = Math.min(1, (this.now - envelope.sent) / span);
      let opacity = 1;
      if (envelope.lost) {
        progress = Math.min(progress, LOST_AT);
        if (this.now >= envelope.dies) {
          if (!node.dataset.lost) {
            node.dataset.lost = '1';
            node.classList.add('lost');
            node.innerHTML = '<span class="x">✕</span>';
            node.append(document.createTextNode(this.spec.numbered ? `${envelope.type} #${envelope.seq}` : envelope.text));
          }
          opacity = Math.max(0, 1 - (this.now - envelope.dies) / 0.6);
        }
      } else if (this.now >= envelope.arrive) {
        opacity = Math.max(0, 1 - (this.now - envelope.arrive) / 0.3);
      }
      const travel = Math.max(0, width - node.offsetWidth);
      const x = envelope.to === 'receiver' ? progress * travel : (1 - progress) * travel;
      const laneTop = envelope.type === 'ACK' ? 0.68 : this.spec.acks ? 0.36 : 0.5;
      const jitter = ((envelope.seq ?? envelope.origin) % 3 - 1) * 9 + (envelope.copy ? 12 : 0);
      const y = laneTop * height - node.offsetHeight / 2 + jitter;
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      node.style.opacity = opacity.toFixed(2);
    }
    for (const [id, node] of this.envelopeNodes) {
      if (!live.has(id)) {
        node.remove();
        this.envelopeNodes.delete(id);
      }
    }
  }

  drawTimers() {
    if (!this.sim.timers.size) return;
    for (const row of this.senderBox.querySelectorAll('.pending-row')) {
      const timer = this.sim.timers.get(row.dataset.seq);
      const circle = row.querySelector('.left');
      if (!timer) {
        circle.setAttribute('stroke-dasharray', '0 100');
        continue;
      }
      const left = Math.max(0, Math.min(1, (timer.at - this.now) / (timer.at - timer.from)));
      circle.setAttribute('stroke-dasharray', `${(left * 100).toFixed(1)} 100`);
    }
  }
}

export async function mountLabs(emit) {
  const roots = Array.from(document.querySelectorAll('[data-lab]'));
  const response = await fetch('data/guarantees.py');
  const source = (await response.text()).replace(/\r/g, '').split('\n');
  const labs = roots.map(root => new Lab(root, root.dataset.lab, source, emit));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const lab = labs.find(item => item.root === entry.target);
      lab.visible = entry.isIntersecting;
    }
  });
  labs.forEach(lab => observer.observe(lab.root));
  let last = performance.now();
  const frame = now => {
    const ms = Math.min(64, now - last);
    last = now;
    for (const lab of labs) {
      if (!lab.visible && !lab.playing) continue;
      lab.tick(ms);
      lab.draw();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    apply(state, elapsed) {
      const lab = labs.find(item => item.kind === state.lab);
      if (lab) lab.applyState(state, elapsed);
    },
    restore(states, now) {
      for (const lab of labs) {
        const state = states[lab.kind];
        if (state) lab.applyState(state, Math.max(0, now - state.stamp));
        else lab.applyState({ lab: lab.kind, mode: 'reset', scenario: 'story', seed: 1, at: 0, speed: 1 });
      }
    }
  };
}
