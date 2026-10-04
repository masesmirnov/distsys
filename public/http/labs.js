import { ICON, element, highlight } from './code.js';
import { Picker } from './picker.js';

const STEP_MS = 1100;
const MIB = 1024 * 1024;

const PYTHON = {
  keywords: new Set(['class', 'def', 'if', 'elif', 'else', 'return', 'while', 'for', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'from', 'import', 'with', 'as', 'try', 'except', 'break', 'self', 'pass']),
  builtins: new Set(['min', 'int', 'str', 'len', 'isinstance', 'open']),
  definers: new Set(['def', 'class'])
};

const TAGS = {
  server: {
    34: 'первая строка',
    38: 'до пустой строки',
    39: 'строка за строкой',
    40: 'разбор',
    41: 'сколько байт тела',
    43: 'дочитать хвост',
    75: 'файл на диске',
    76: 'тело прямо в файл',
    102: 'ровно body_left',
    103: 'не больше 64 КБ',
    104: 'клиент пропал',
    108: 'сразу на диск',
    115: 'во временный файл',
    117: 'длина после сжатия',
    118: 'в начало',
    121: 'кусками по 64 КБ',
    125: 'на диске',
    127: 'сжатие кусками'
  }
};

const SOURCES = { server: 'solution/server.py' };

const CHANGES = {
  'bounds:eof': { removed: [37, 38, 39, 40], added: [[36, '        data = first_line + self.rfile.read()'], [40, '        request = HTTPRequest.from_bytes(data)']] },
  'bounds:recv': { removed: [34, 35, 37, 38, 39, 40], added: [[34, '        data = self.request.recv(65536)'], [40, '        request = HTTPRequest.from_bytes(data)']] },
  'large:whole': { removed: [103], added: [[103, '            chunk = self.rfile.read(self.body_left)']] },
  'gzip:length': { removed: [117], added: [[117, '        headers[HEADER_CONTENT_LENGTH] = str(body.stat().st_size)']] },
  'gzip:memory': { removed: [125], added: [[125, '    compressed = io.BytesIO()']] }
};

const STATES = {
  ready: 'ждёт старта',
  wait: 'ждёт',
  bytes: 'ждёт байты',
  done: 'готово',
  error: 'сбой'
};

const REQUEST = ['POST /no', 'tes.txt HTTP/1.1\r\nHost: loc', 'alhost\r\nContent-Length: 11\r\n\r', '\nhello wo', 'rld'];

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

function breakable(html) {
  return html.replace(/([(.,])/g, '$1<wbr>');
}

function show(text) {
  return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function bytes(value) {
  return Math.round(value).toLocaleString('ru-RU');
}

function mib(value) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function spread(rows, count) {
  if (rows.length <= count) return rows;
  return Array.from({ length: count }, (_, index) => rows[Math.round((rows.length - 1) * (index + 1) / count)]);
}

function* waitBytes(world, thread, ready, lines, note) {
  while (!ready()) {
    const seen = world.sent;
    thread.state = 'bytes';
    thread.waitFor = () => world.sent === seen && !world.closed;
    yield { lines, note: note() };
    thread.waitFor = null;
    thread.state = 'run';
  }
}

function* readline(world, thread, line) {
  yield* waitBytes(world, thread, () => world.socket.includes('\n'), [line],
    () => world.socket ? `readline ждёт конец строки: в сокете только «${show(world.socket)}»` : 'readline ждёт: в сокете пусто');
  const at = world.socket.indexOf('\n') + 1;
  const value = world.socket.slice(0, at);
  world.socket = world.socket.slice(at);
  return value;
}

function parseRequest(text) {
  const [first, ...rest] = text.split('\r\n');
  const [method, path] = first.split(' ');
  const headers = {};
  for (const line of rest) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { method, path, headers };
}

function* handleRequest(world, thread) {
  const first = yield* readline(world, thread, 34);
  world.lines.push(first);
  thread.set('first_line', `«${show(first)}»`);
  yield { lines: [34], note: `readline() вернул «${show(first)}»` };
  for (;;) {
    const line = yield* readline(world, thread, 39);
    world.lines.push(line);
    thread.set('lines[-1]', `«${show(line)}»`);
    if (line === '\r\n') {
      yield { lines: [38, 39], note: 'readline() вернул «\\r\\n»: это пустая строка, цикл кончился, заголовки прочитаны' };
      break;
    }
    yield { lines: [38, 39], note: `readline() вернул «${show(line)}»` };
  }
  world.request = parseRequest(world.lines.join(''));
  yield { lines: [40], note: `from_bytes: ${world.request.method} ${world.request.path}, заголовки ${Object.keys(world.request.headers).join(' и ')}` };
  world.bodyLeft = Number(world.request.headers['content-length'] || 0);
  thread.set('body_left', String(world.bodyLeft));
  yield { lines: [41], note: `body_left = ${world.bodyLeft}: ровно столько байт тела и прочитаем` };
  world.file = '';
  yield { lines: [42], note: 'process → post: файла нет, папка есть → open("wb") и read_body(file)' };
  while (world.bodyLeft > 0) {
    const want = Math.min(65536, world.bodyLeft);
    yield* waitBytes(world, thread, () => world.socket.length >= want, [102, 103],
      () => `rfile.read(${want}) ждёт: в сокете ${world.socket.length} байт из ${want}`);
    const chunk = world.socket.slice(0, want);
    world.socket = world.socket.slice(want);
    world.bodyLeft -= chunk.length;
    world.file += chunk;
    thread.set('body_left', String(world.bodyLeft));
    yield { lines: [103, 106, 107, 108], note: `read вернул «${chunk}» → body_left = ${world.bodyLeft}, всё записано в notes.txt` };
  }
  yield { lines: [43], note: 'read_body(None): body_left = 0, дочитывать нечего' };
  world.reply = 'HTTP/1.1 200 OK';
  return { lines: [44], note: 'send: «HTTP/1.1 200 OK» и Content-Length: 0, соединение закрывается' };
}

function* handleUntilEof(world, thread) {
  const first = yield* readline(world, thread, 34);
  thread.set('first_line', `«${show(first)}»`);
  yield { lines: [34], note: `readline() вернул «${show(first)}»` };
  for (;;) {
    const seen = world.sent;
    thread.state = 'bytes';
    thread.waitFor = () => world.sent === seen;
    thread.set('прочитано', `${world.socket.length} байт`);
    yield { lines: [36.5], note: world.sent === world.pieces.length
      ? 'весь запрос уже пришёл, но read() без размера ждёт конца потока, а клиент соединение не закрывает'
      : `read() без размера копит байты до конца потока: уже «${show(world.socket)}»` };
    thread.waitFor = null;
    thread.state = 'run';
  }
}

function* handleOneRecv(world, thread) {
  yield* waitBytes(world, thread, () => world.socket.length > 0, [34.5], () => 'recv(65536) ждёт, пока придёт хоть что-нибудь');
  const data = world.socket;
  world.socket = '';
  world.received = data;
  thread.set('data', `«${show(data)}»`);
  yield { lines: [34.5], note: `recv вернул только то, что уже пришло: «${show(data)}»` };
  world.closed = true;
  return { lines: [40.5], note: `«${data}».split(" ") даёт две части вместо трёх: ValueError, main ловит его и закрывает соединение`, error: true };
}

function* client(world, thread) {
  for (const piece of world.pieces) {
    if (world.closed) break;
    world.socket += piece;
    world.sent += 1;
    thread.set('отправлено', `${world.sent} из ${world.pieces.length}`);
    yield { lines: [], note: `send(«${show(piece)}»)` };
  }
  if (!world.closed && !world.reply) {
    thread.state = 'wait';
    thread.waitFor = () => !world.reply && !world.closed;
    yield { lines: [], note: 'отправил всё и ждёт ответ, соединение не закрывает' };
    thread.waitFor = null;
    thread.state = 'run';
  }
  if (world.reply) return { lines: [], note: `получил «${world.reply}»` };
  return { lines: [], note: 'сервер закрыл соединение, ответа нет', error: true };
}

function memoryRun(data, id, variant) {
  return data.scenarios.find(item => item.id === id && item.variant === variant);
}

function* largeServer(world, thread, variant) {
  const run = world.run;
  thread.set('body_left', bytes(run.size));
  yield { lines: [68, 70], note: 'post: /big ещё нет, папка есть, пишем файл' };
  yield { lines: [75, 76], note: 'open("wb") и read_body(file): тело пойдёт прямо в файл' };
  const whole = variant === 'whole';
  for (const [, got, anon] of spread(run.samples.filter(row => row[1] > 0), 7)) {
    world.received = got;
    world.memory = anon;
    world.trace.push(anon);
    if (!whole) {
      world.file = got;
      thread.set('body_left', bytes(run.size - got * MIB));
    }
    yield whole
      ? { lines: [102, 103.5], note: `rfile.read(${bytes(run.size)}) ещё не вернул: принято ${mib(got)} МиБ, и всё это лежит в памяти, ${mib(anon)} МиБ` }
      : { lines: [102, 103, 106, 107, 108], note: `принято ${mib(got)} МиБ, а в памяти процесса ${mib(anon)} МиБ: кусок не больше 64 КБ сразу уходит в файл` };
  }
  if (run.killed) {
    world.killed = true;
    return { lines: [103.5], note: `лимит 128 МБ: ядро убило процесс на ${mib(run.peak_mib)} МиБ (exit ${run.exit_code}), клиент получил обрыв`, error: true };
  }
  world.reply = run.response;
  thread.set('body_left', '0');
  return { lines: [77], note: `на диске ${bytes(run.size)} байт, ответ «${run.response}»` };
}

function* gzipServer(world, thread, variant) {
  const run = world.run;
  yield { lines: [111, 112, 113], note: `GET /big: файл ${bytes(run.size)} байт, клиент прислал Accept-Encoding: gzip` };
  yield { lines: [114, 115], note: 'метод GET, статус 200, gzip просили → compress(source)' };
  const inMemory = variant === 'memory';
  for (const [, , anon] of spread(run.samples.filter(row => row[1] === 0), 3)) {
    world.memory = anon;
    world.trace.push(anon);
    world.phase = 'compress';
    yield { lines: inMemory ? [125.5, 126, 127] : [125, 126, 127], note: inMemory
      ? `сжатое копится в BytesIO, то есть в памяти: ${mib(anon)} МиБ`
      : `GzipFile пишет во временный файл кусками по 64 КБ: в памяти ${mib(anon)} МиБ` };
  }
  if (run.killed) {
    world.killed = true;
    return { lines: [125.5], note: `лимит 128 МБ: процесс убит на ${mib(run.peak_mib)} МиБ (exit ${run.exit_code}), клиент не получил даже заголовков`, error: true };
  }
  world.compressed = run.content_length;
  yield { lines: [116], note: 'Content-Encoding: gzip' };
  world.declared = variant === 'length' ? run.size : run.content_length;
  thread.set('Content-Length', bytes(world.declared));
  yield variant === 'length'
    ? { lines: [117.5], note: `Content-Length = размер файла до сжатия, ${bytes(run.size)}, а сжатых байт ${bytes(run.content_length)}` }
    : { lines: [117], note: `seek(0, SEEK_END) = ${bytes(run.content_length)}: это длина уже сжатых данных, её и заявляем` };
  yield { lines: [118, 119], note: 'seek(0), и заголовки ушли клиенту' };
  for (const [, sent, anon] of spread(run.samples.filter(row => row[1] > 0), 3)) {
    world.sent = sent;
    world.memory = anon;
    world.trace.push(anon);
    world.phase = 'send';
    yield { lines: [120, 121], note: `copyfileobj: отправлено ${mib(sent)} МиБ, в памяти ${mib(anon)} МиБ` };
  }
  world.phase = 'done';
  if (variant === 'length') {
    return { lines: [121], note: `клиент перестал читать на ${bytes(run.size)} байте, а сервер прислал ещё ${bytes(run.content_length - run.size)}: хвост gzip отрезан` };
  }
  return { lines: [121], note: `клиент прочитал ровно ${bytes(run.content_length)} байт и распаковал ${bytes(run.payload)}` };
}

const LABS = {
  bounds: {
    variants: { ok: 'решение', eof: 'читать до закрытия', recv: 'один recv' },
    idle: 'клиент ещё ничего не отправил',
    panes: [
      { file: 'server', title: 'handle', range: [33, 44] },
      { file: 'server', title: 'read_body', range: [101, 108] }
    ],
    world: () => ({ pieces: REQUEST, sent: 0, socket: '', lines: [], request: null, bodyLeft: null, file: null, reply: null, closed: false, received: null }),
    threads: [
      { name: 'сервер', call: 'HTTPHandler.handle()', run: (world, thread, variant) => (variant === 'eof' ? handleUntilEof : variant === 'recv' ? handleOneRecv : handleRequest)(world, thread) },
      { name: 'клиент', call: 'POST /notes.txt пятью кусками', run: (world, thread) => client(world, thread) }
    ],
    render: renderBounds,
    verdict: world => {
      if (world.reply) return { ok: true, text: `заголовки кончились на пустой строке, тело ровно ${world.request.headers['content-length']} байт по Content-Length, в notes.txt «${world.file}»` };
      if (world.closed) return { ok: false, text: `recv отдал только «${world.received}», запрос порвался, и клиент остался без ответа` };
      return { ok: false, text: 'клиент ждёт ответ, сервер ждёт конца потока: зависли оба, в тестах это таймаут' };
    }
  },
  large: {
    variants: { ok: 'решение', whole: 'тело целиком' },
    idle: 'POST /big, Content-Length: 200 278 016',
    panes: [
      { file: 'server', title: 'post', range: [67, 77] },
      { file: 'server', title: 'read_body', range: [101, 108] }
    ],
    world: (variant, data) => ({ run: memoryRun(data, 'post', variant === 'whole' ? 'whole-body' : 'solution'), received: 0, memory: 0, trace: [], file: 0, reply: null, killed: false }),
    threads: [
      { name: 'сервер', call: 'POST /big на 191 МиБ', run: (world, thread, variant) => largeServer(world, thread, variant) }
    ],
    render: renderLarge,
    verdict: world => world.killed
      ? { ok: false, text: `read() копит всё тело в памяти: на ${mib(world.run.peak_mib)} МиБ процесс убит, клиент получил обрыв` }
      : { ok: true, text: `191 МиБ приняты, а память процесса всё время ${mib(world.run.peak_mib)} МиБ: в памяти лежит не больше одного куска` }
  },
  gzip: {
    variants: { ok: 'решение', length: 'длина до сжатия', memory: 'сжатие в памяти' },
    idle: 'GET /big, Accept-Encoding: gzip',
    panes: [
      { file: 'server', title: 'send', range: [110, 121] },
      { file: 'server', title: 'compress', range: [124, 128] }
    ],
    world: (variant, data) => ({ run: memoryRun(data, 'gzip', variant === 'memory' ? 'gzip-in-memory' : 'solution'), memory: 0, trace: [], phase: 'idle', compressed: null, declared: null, sent: 0, killed: false }),
    threads: [
      { name: 'сервер', call: 'GET /big с gzip', run: (world, thread, variant) => gzipServer(world, thread, variant) }
    ],
    render: renderGzip,
    verdict: (world, race, variant) => {
      if (world.killed) return { ok: false, text: `BytesIO держит всё сжатое в памяти: на ${mib(world.run.peak_mib)} МиБ процесс убит` };
      if (variant === 'length') return { ok: false, text: `заявлено ${bytes(world.declared)}, отправлено ${bytes(world.compressed)}: лишние байты за концом ответа, а у клиента обрезанный gzip` };
      return { ok: true, text: `Content-Length ${bytes(world.compressed)} = длина сжатого, распаковано ${bytes(world.run.payload)} = весь файл, память не выше ${mib(world.run.peak_mib)} МиБ` };
    }
  }
};

class Race {
  constructor(spec, variant, data) {
    this.world = spec.world(variant, data);
    this.threads = spec.threads.map((item, index) => new Thread(index, item));
    for (const thread of this.threads) thread.program = thread.spec.run(this.world, thread, variant);
    this.steps = 0;
    this.last = null;
    this.finished = false;
  }

  ready(thread) {
    return thread.live() && !thread.blocked();
  }

  step() {
    const thread = this.finished ? null : this.threads.find(item => this.ready(item));
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

function piecesRow(world) {
  const row = element('span', 'chips');
  world.pieces.forEach((piece, index) => {
    const chip = element('span', 'msg piece' + (index < world.sent ? ' a0' : ' pending'));
    chip.textContent = show(piece);
    row.append(chip);
  });
  return row;
}

function wireBox(text, empty) {
  const box = element('span', 'bytes-box');
  box.textContent = text ? show(text) : empty;
  if (!text) box.classList.add('empty');
  return box;
}

function line(name, content) {
  const row = element('div', 'sub', `<span class="sub-name">${name}</span>`);
  row.append(content);
  return row;
}

function renderBounds(world) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>соединение</b>');
  head.append(element('span', `pill ${world.closed ? 'broken' : 'open'}`, world.closed ? 'закрыто сервером' : 'открыто'));
  card.append(head);
  card.append(line('куски', piecesRow(world)));
  card.append(line('в сокете', wireBox(world.socket, 'пусто')));
  const lines = element('span', 'chips');
  if (!world.lines.length) lines.append(element('span', 'empty', 'пусто'));
  world.lines.forEach(text => {
    const chip = element('span', 'msg a1');
    chip.textContent = show(text);
    lines.append(chip);
  });
  card.append(line('lines', lines));
  if (world.request) {
    const parsed = element('span', 'bytes-box');
    parsed.textContent = `${world.request.method} ${world.request.path}, ` + Object.entries(world.request.headers).map(([name, value]) => `${name}: ${value}`).join(', ');
    card.append(line('request', parsed));
  }
  if (world.file !== null) card.append(line('notes.txt', wireBox(world.file, 'пустой')));
  if (world.reply) card.append(line('ответ', wireBox(world.reply, '')));
  return card;
}

function gauge(world) {
  const box = element('div', 'gauge' + (world.killed ? ' dead' : world.memory > 96 ? ' hot' : ''));
  const fill = element('span', 'gauge-fill');
  fill.style.width = `${Math.min(100, world.memory / 128 * 100)}%`;
  const limit = element('span', 'gauge-limit');
  box.append(fill, limit, element('span', 'gauge-text', world.killed ? `убит, лимит 128 МиБ` : `${mib(world.memory)} МиБ из 128`));
  const spark = element('span', 'spark');
  const top = 128;
  world.trace.forEach(value => {
    const bar = element('i');
    bar.style.height = `${Math.max(4, value / top * 100)}%`;
    spark.append(bar);
  });
  const holder = element('div', 'gauge-row');
  holder.append(box, spark);
  return holder;
}

function progress(done, total, text) {
  const box = element('div', 'progress');
  const fill = element('span', 'progress-fill');
  fill.style.width = `${Math.min(100, done / total * 100)}%`;
  box.append(fill, element('span', 'progress-text', text));
  return box;
}

function renderLarge(world) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>процесс сервера</b>');
  head.append(element('span', `pill ${world.killed ? 'broken' : 'open'}`, world.killed ? 'exit 137' : world.reply ? world.reply : 'работает'));
  card.append(head);
  const total = world.run.size / MIB;
  card.append(line('принято', progress(world.received, total, `${mib(world.received)} из ${mib(total)} МиБ`)));
  card.append(line('память', gauge(world)));
  card.append(line('big на диске', wireBox(world.file ? `${mib(world.file)} МиБ` : '', world.killed ? 'не дошло' : 'пусто')));
  return card;
}

function renderGzip(world) {
  const card = element('div', 'world');
  const head = element('div', 'world-head', '<b>процесс сервера</b>');
  const phase = { idle: 'ждёт', compress: 'сжимает', send: 'отправляет', done: 'отправил' }[world.phase];
  head.append(element('span', `pill ${world.killed ? 'broken' : 'open'}`, world.killed ? 'exit 137' : phase));
  card.append(head);
  card.append(line('память', gauge(world)));
  card.append(line('файл', wireBox(`${bytes(world.run.size)} байт`, '')));
  card.append(line('сжатое', wireBox(world.compressed ? `${bytes(world.compressed)} байт` : '', world.killed ? 'не дожало' : 'ещё не готово')));
  if (world.declared !== null) {
    const ok = world.declared === world.compressed;
    const value = element('span', `bytes-box ${ok ? 'good' : 'bad'}`);
    value.textContent = `${bytes(world.declared)} ${ok ? '= сжатое' : '≠ сжатое'}`;
    card.append(line('Content-Length', value));
  }
  if (world.sent) {
    const total = world.compressed / MIB;
    card.append(line('отправлено', progress(world.sent, total, `${mib(world.sent)} из ${mib(total)} МиБ`)));
  }
  return card;
}

function transform(lines, change) {
  if (!change) return lines.map(([number, text]) => ({ number, text, mark: '' }));
  const inside = (ranges, number) => (ranges || []).some(([from, to]) => number >= from && number <= to);
  return lines.flatMap(([number, text]) => [
    { number, text: inside(change.dedent, number) ? text.replace(/^ {4}/, '') : text, mark: (change.removed || []).includes(number) ? 'removed' : '' },
    ...(change.added || []).filter(([after]) => after === number).map(([, extra]) => ({ number: number + 0.5, text: extra, mark: 'added' }))
  ]);
}

class Lab {
  constructor(root, id, sources, data, emit) {
    this.root = root;
    this.id = id;
    this.spec = LABS[id];
    this.sources = sources;
    this.data = data;
    this.emit = emit;
    this.variant = 'ok';
    this.speed = 1;
    this.speedTimer = 0;
    this.playing = false;
    this.finished = false;
    this.now = 0;
    this.totals = new Map();
    this.previousVars = new Map();
    this.build();
    this.seek(0);
  }

  build() {
    const head = element('div', 'lab-head');
    this.picker = new Picker(Object.entries(this.spec.variants), 'Вариант кода', value => this.control('reset', value));
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
    head.append(this.picker.root, this.speedBox, this.playButton, this.stepButton, this.resetButton);

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
      title.append(element('span', '', `${SOURCES[spec.file].split('/').pop()}, строки ${spec.range[0]}–${spec.range[1]}`));
      const pre = element('pre', 'code');
      pane.append(title, pre);
      panes.append(pane);
      return { spec, pre, rows: new Map() };
    });

    this.root.append(head, stage, this.caption, this.verdictBox, panes);

    this.playButton.addEventListener('click', () => this.control(this.playing ? 'pause' : 'play'));
    this.stepButton.addEventListener('click', () => this.control('step'));
    this.resetButton.addEventListener('click', () => this.control('reset'));
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
      for (const item of lines) {
        const row = element('span', 'ln' + (item.mark ? ' ' + item.mark : ''), `<span class="no"><span class="pcs"></span>${item.mark === 'added' ? '+' : item.number}</span><span class="src">${breakable(highlight(item.text, PYTHON)) || ' '}</span>`);
        if (item.mark) row.title = item.mark === 'removed' ? 'в этом варианте строки нет' : 'в этом варианте строка добавлена';
        if (tags[item.number] && !item.mark) row.append(element('span', 'tag', tags[item.number]));
        pane.rows.set(item.number, row);
        pane.pre.append(row);
      }
    }
  }

  total() {
    if (!this.totals.has(this.variant)) {
      const race = new Race(this.spec, this.variant, this.data);
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
    this.picker.set(variant);
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
    this.race = new Race(this.spec, this.variant, this.data);
    this.playing = false;
    this.finished = false;
    const target = Math.floor(Math.max(0, at));
    while (this.race.steps < target && !this.race.finished) this.race.step();
    this.now = Math.min(Math.max(0, at), this.race.steps + 0.999);
    this.verdictBox.className = 'verdict';
    this.verdictBox.replaceChildren();
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
    const verdict = this.spec.verdict(this.race.world, this.race, this.variant);
    this.verdictBox.className = 'verdict shown' + (verdict.ok ? '' : ' bad');
    this.verdictBox.innerHTML = `${ICON(verdict.ok ? 'check' : 'x')}<span></span>`;
    this.verdictBox.querySelector('span').textContent = verdict.text;
    this.updateButtons();
  }

  render() {
    this.renderThreads();
    this.worldBox.replaceChildren(this.spec.render(this.race.world, this.race));
    this.markCode();
    const last = this.race.last;
    this.caption.querySelector('.t').textContent = `шаг ${this.race.steps}/${this.total()}`;
    const what = this.caption.querySelector('.what');
    what.replaceChildren();
    if (last) {
      const who = element('span', `who t${last.thread}`, this.race.threads[last.thread].name);
      what.append(who, document.createTextNode(' ' + last.note));
    } else {
      what.textContent = this.spec.idle;
    }
  }

  renderThreads() {
    const active = this.race.last ? this.race.last.thread : -1;
    this.threadsBox.replaceChildren(...this.race.threads.map(thread => {
      const card = element('div', `thread t${thread.index} ${thread.state}` + (thread.index === active ? ' active' : ''));
      const head = element('div', 'thread-head');
      head.append(element('span', 'dot'), element('b', '', thread.name));
      const state = STATES[thread.state] || (thread.lines.length ? `строка ${Math.floor(thread.lines[thread.lines.length - 1])}` : 'идёт');
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

export async function mountLabs(emit, data) {
  const roots = Array.from(document.querySelectorAll('[data-race]'));
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([file, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(url);
    return [file, (await response.text()).replace(/\r/g, '').split('\n')];
  }));
  const sources = Object.fromEntries(entries);
  const labs = roots.map(root => new Lab(root, root.dataset.race, sources, data, emit));
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
