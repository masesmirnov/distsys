import { mountLabs } from './labs.js';
import { startBoard, toast } from './board.js';
import { mountLive } from './live.js';
import { ICON, element, highlight } from './code.js';
import { setupNavigation, setupTheme } from './page.js';
import { mark, markOnSight, markVerdicts, mountSketches } from './ink.js';
import { SKETCHES } from './sketches.js';
import { DRAWINGS } from './drawings.js';

const PYTHON = {
  keywords: new Set(['class', 'def', 'if', 'else', 'return', 'while', 'for', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'from', 'import', 'with', 'as', 'try', 'except', 'break', 'self', 'pass', 'raise']),
  builtins: new Set(['min', 'int', 'str', 'len', 'isinstance', 'open', 'SystemExit', 'Exception', 'OSError']),
  definers: new Set(['def', 'class'])
};

const CARDS = [
  {
    holder: 'main-code',
    url: 'solution/server.py',
    title: 'main',
    range: [131, 176],
    tags: {
      132: 'CLI, потом env, потом default',
      135: 'без default',
      137: 'нет папки → код 1',
      147: 'TCP-сокет',
      150: 'порт сразу снова свободен',
      153: 'host и port из параметров',
      158: 'настройки для обработчика',
      163: 'ждёт клиента',
      169: 'setup → handle → finish',
      172: 'клиент видит конец ответа',
      175: 'ошибка запроса → в лог'
    }
  },
  {
    holder: 'messages-code',
    url: 'solution/http_messages.py',
    title: 'HTTPRequest и HTTPResponse',
    range: [13, 36],
    tags: {
      18: 'режем по CRLF',
      19: 'метод, путь, версия',
      20: 'по первому двоеточию',
      21: 'имена в нижний регистр',
      22: 'параметры не нужны',
      34: 'статус и причина',
      35: 'по строке на заголовок',
      36: 'и пустая строка'
    }
  }
];

const GROUPS = {
  G1: 'GET текстовых файлов, запуск и параметры',
  G2: 'GET файлов с произвольными байтами',
  G3: 'GET файлов и папок, 404',
  G4: 'GET, POST, PUT и DELETE, листинг и ошибки',
  G5: 'G4 плюс Host, Content-Type и Server',
  G6: 'G4 и файлы до 191 МиБ в 128 МБ',
  G7: 'G6, заголовки из G5 и gzip'
};

const CHARTS = [
  { id: 'post', title: 'POST 191 МиБ', broken: 'whole-body' },
  { id: 'get', title: 'GET 160 МиБ', broken: 'whole-file' },
  { id: 'gzip', title: 'GET 160 МиБ с gzip', broken: 'gzip-in-memory' }
];

const GAPS = [
  { title: 'Домен внутри Host', rule: 'при несовпадении вернуть 400', file: 'server.py', markers: ['not in request.headers.get(HEADER_HOST'], header: 'host' },
  { title: 'Путь через файл', rule: 'такой путь обрабатывается как отсутствующий', file: 'server.py', markers: ['NotADirectoryError'] },
  { title: 'Content-Encoding в ошибке', rule: 'в несжатом ответе отсутствует', file: 'server.py', markers: ['if GZIP in request', 'if request.method == GET and status == OK:'], header: 'accept-encoding', detail: 'encoding' },
  { title: '«.» и «..» в листинге', rule: 'все имена, включая скрытые файлы, но без . и ..', file: 'server.py', markers: ['b".."'], detail: 'listing' },
  { title: 'Пробел после двоеточия', rule: 'запросы синтаксически корректны, формат по RFC 9112', file: 'http_messages.py', markers: ['split(": "'], header: 'host' }
];

function plural(count, one, few, many) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

function mib(value) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

async function lines(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  return (await response.text()).replace(/\r/g, '').split('\n');
}

async function loadCode(card) {
  const holder = document.getElementById(card.holder);
  const source = await lines(card.url);
  const title = element('div', 'code-title', `<b>${card.title}</b>`);
  title.append(element('span', '', `${card.url.split('/').pop()}, строки ${card.range[0]}–${card.range[1]}`));
  const pre = element('pre', 'code');
  for (let number = card.range[0]; number <= card.range[1]; number++) {
    const row = element('span', 'ln', `<span class="no">${number}</span><span class="src">${highlight(source[number - 1], PYTHON).replace(/([(.,])/g, '$1<wbr>') || ' '}</span>`);
    if (card.tags[number]) row.append(element('span', 'tag', card.tags[number]));
    pre.append(row);
  }
  holder.replaceChildren(title, pre);
}

async function loadResults() {
  try {
    const response = await fetch('data/results.json');
    const results = await response.json();
    document.getElementById('tests-grid').replaceChildren(...results.groups.map(group => {
      const card = element('div', 'card');
      const title = element('h3', '', group.name);
      title.append(element('span', 'status ' + (group.score === group.max ? 'ok' : 'fail'), `${group.score}/${group.max}`));
      const list = element('ul');
      const queries = group.runs.reduce((sum, run) => sum + run.queries, 0);
      const items = [
        `${group.runs.length} ${plural(group.runs.length, 'запуск', 'запуска', 'запусков')}, ${queries} ${plural(queries, 'запрос', 'запроса', 'запросов')}`,
        `${group.contract} ${plural(group.contract, 'точечная проверка', 'точечные проверки', 'точечных проверок')}`
      ];
      if (group.exit_check) items.push('без папки выход с кодом 1');
      list.append(...items.map(text => element('li', '', text)));
      card.append(title, element('p', 'group-what', GROUPS[group.name] || ''), list);
      return card;
    }));
    document.querySelector('[data-value="image"]').textContent = results.image;
    markOnSight(Array.from(document.querySelectorAll('.results-grid h3 .status')), 'circle');
  } catch {
    toast('Не удалось загрузить результаты тестов');
  }
}

function svgNode(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function memoryChart(data, chart) {
  const good = data.scenarios.find(item => item.id === chart.id && item.variant === 'solution');
  const bad = data.scenarios.find(item => item.id === chart.id && item.variant === chart.broken);
  const card = element('div', 'card chart memory-card');
  card.append(element('div', 'chart-title', chart.title));
  card.append(element('div', 'chart-sub', `поломка: ${data.variants[chart.broken][0]}`));
  const width = 360;
  const height = 176;
  const left = 40;
  const right = 12;
  const top = 10;
  const bottom = 26;
  const end = Math.max(...good.samples.map(row => row[0]), ...bad.samples.map(row => row[0]), bad.seconds);
  const x = value => left + value / end * (width - left - right);
  const y = value => top + (1 - value / 140) * (height - top - bottom);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${chart.title}, память процесса во времени` });
  for (const value of [0, 64]) {
    svg.append(svgNode('line', { class: 'grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
    svg.append(svgNode('text', { class: 'tick', x: left - 6, y: y(value) + 4, 'text-anchor': 'end' }, String(value)));
  }
  svg.append(svgNode('line', { class: 'limit', x1: left, x2: width - right, y1: y(128), y2: y(128), 'stroke-dasharray': '5 4' }));
  svg.append(svgNode('text', { class: 'limit-label', x: left - 6, y: y(128) + 4, 'text-anchor': 'end' }, '128'));
  svg.append(svgNode('text', { class: 'tick', x: width - right, y: height - 6, 'text-anchor': 'end' }, `${mib(end)} с`));
  svg.append(svgNode('text', { class: 'tick', x: left, y: height - 6 }, '0'));
  const line = (rows, kind) => {
    if (!rows.length) return;
    svg.append(svgNode('polyline', { class: `series ${kind}`, points: rows.map(row => `${x(row[0]).toFixed(1)},${y(row[2]).toFixed(1)}`).join(' ') }));
  };
  line(good.samples, 'ok');
  line(bad.samples, 'bad');
  const last = bad.samples[bad.samples.length - 1];
  const killX = x(last ? last[0] : bad.seconds);
  const killY = y(last ? last[2] : 128);
  svg.append(svgNode('path', { class: 'kill', d: `M${killX - 5} ${killY - 5}L${killX + 5} ${killY + 5}M${killX + 5} ${killY - 5}L${killX - 5} ${killY + 5}` }));
  card.append(svg);
  const legend = element('div', 'legend');
  legend.append(element('span', 'key ok', `решение держится на ${mib(good.peak_mib)} МиБ`));
  legend.append(element('span', 'key bad', bad.samples.length
    ? `поломку убили на ${mib(bad.peak_mib)} МиБ`
    : `поломку убили через ${mib(bad.seconds)} с, до первого замера`));
  card.append(legend);
  return card;
}

function renderMemory(data) {
  document.getElementById('memory').replaceChildren(...CHARTS.map(chart => memoryChart(data, chart)));
  const note = document.getElementById('memory-note');
  note.replaceChildren(document.createTextNode(`Контейнер запускался с ${data.docker.split(',')[0]}, как у тестера. Память процесса здесь это anon из memory.stat, без страничного кэша. `));
  note.append(Object.assign(document.createElement('a'), { href: 'data/memory.json', textContent: 'Все замеры' }));
}

function diffOps(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({ kind: 'same', text: before[i] });
      i++;
      j++;
    } else if (i < before.length && (j === after.length || table[i + 1][j] >= table[i][j + 1])) {
      ops.push({ kind: 'del', text: before[i++] });
    } else {
      ops.push({ kind: 'add', text: after[j++] });
    }
  }
  return ops;
}

function hunk(ops, markers) {
  const hits = ops.flatMap((op, index) => (op.kind !== 'same' && markers.some(marker => op.text.includes(marker)) ? [index] : []));
  if (!hits.length) return [];
  let start = Math.min(...hits);
  let end = Math.max(...hits);
  while (start > 0 && ops[start - 1].kind !== 'same') start--;
  while (end < ops.length - 1 && ops[end + 1].kind !== 'same') end++;
  return ops.slice(start, end + 1);
}

function decode(base64) {
  return new TextDecoder().decode(Uint8Array.from(atob(base64 || ''), char => char.charCodeAt(0)));
}

function parse(row) {
  const text = decode(row.response);
  const end = text.indexOf('\r\n\r\n');
  const [first, ...rest] = (end < 0 ? text : text.slice(0, end)).split('\r\n');
  const headers = {};
  for (const line of rest) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { first: first.replace(/^HTTP\/1\.1 /, ''), headers, body: end < 0 ? '' : text.slice(end + 4) };
}

function asked(row, gap) {
  const [first, ...rest] = decode(row.request).split('\r\n');
  const header = gap.header && rest.find(line => line.toLowerCase().startsWith(gap.header));
  return first.replace(/ HTTP\/1\.1$/, '') + (header ? ` с ${header}` : '');
}

function names(answer) {
  return answer.body.split('\n').filter(Boolean);
}

function said(row, gap, kind, ours) {
  if (!row.status) return 'соединение закрыто без ответа';
  const answer = parse(row);
  const parts = [answer.first];
  if (gap.detail === 'encoding') {
    const encoding = answer.headers['content-encoding'];
    parts.push(encoding ? `Content-Encoding: ${encoding}, тело ${row.decoded === null ? 'не распаковывается' : 'распаковывается'}` : 'без Content-Encoding');
  }
  if (gap.detail === 'listing' && kind === 'tests') {
    const expected = names(parse(ours));
    parts.push(expected.every(name => names(answer).includes(name)) ? 'все имена на месте' : 'не хватает имён');
  }
  if (gap.detail === 'listing' && kind === 'gap') {
    const listed = names(answer);
    parts.push(listed.length ? `в листинге ${listed.map(name => `«${name}»`).join(', ')}` : 'листинг пустой');
  }
  return parts.join(', ');
}

function mountGaps(live) {
  const state = { current: 0, results: GAPS.map(() => null), hunks: GAPS.map(() => []), pending: new Set(), enabled: false };
  const tabs = element('div', 'segmented');
  const card = element('div', 'card gap');
  const rule = element('p', 'gap-rule');
  const label = element('div', 'code-label');
  const diff = element('pre', 'diff');
  const table = element('table', 'gap-table');
  const button = element('button', 'chip-button', `${ICON('send')}<span>Проверить сейчас</span>`);
  button.type = 'button';
  const when = element('span', 'gap-when');
  const code = element('div', 'gap-code');
  code.append(label, diff);
  const foot = element('div', 'gap-foot');
  foot.append(button, when);
  const check = element('div', 'gap-check');
  check.append(table, foot);
  const body = element('div', 'gap-body');
  body.append(code, check);
  card.append(rule, body);
  document.getElementById('gaps-grid').replaceChildren(tabs, card);

  const render = () => {
    const gap = GAPS[state.current];
    const result = state.results[state.current];
    const pending = state.pending.has(state.current);
    for (const [index, tab] of Array.from(tabs.children).entries()) tab.setAttribute('aria-pressed', String(index === state.current));
    rule.replaceChildren(element('span', 'muted', 'условие '), document.createTextNode(`«${gap.rule}»`));
    label.textContent = `${gap.file} в сломанной копии`;
    const part = state.hunks[state.current];
    const indent = part.length ? Math.min(...part.map(op => op.text.length - op.text.trimStart().length)) : 0;
    diff.replaceChildren(...part.map(op => {
      const row = element('span', `ln ${op.kind}`);
      row.textContent = `${{ same: ' ', del: '−', add: '+' }[op.kind]} ${op.text.slice(indent)}`;
      return row;
    }));
    const head = element('tr');
    head.append(element('th', '', ''), element('th', '', 'сломанная копия'), element('th', '', 'наш server.py'));
    const rows = [head];
    for (const [kind, title] of [['tests', 'как в тестах'], ['gap', 'дыра']]) {
      const row = element('tr');
      const name = element('th', '', title);
      if (result) name.append(element('span', 'asked', asked(result.rows[kind].broken, gap)));
      row.append(name);
      const texts = result ? ['broken', 'ours'].map(side => said(result.rows[kind][side], gap, kind, result.rows[kind].ours)) : ['—', '—'];
      texts.forEach((text, column) => {
        const cell = element('td', column === 0 && result && text !== texts[1] ? 'differs' : '');
        cell.textContent = text;
        row.append(cell);
      });
      rows.push(row);
    }
    table.replaceChildren(...rows);
    button.disabled = !state.enabled || pending;
    button.title = state.enabled ? '' : 'живой сервер или сломанная копия выключены';
    when.textContent = pending ? 'гоняю четыре запроса…' : result ? `проверил ${result.by} в ${new Date(result.at).toLocaleTimeString('ru-RU')}` : '';
  };

  tabs.append(...GAPS.map((gap, index) => {
    const tab = element('button', '', gap.title);
    tab.type = 'button';
    tab.addEventListener('click', () => {
      state.current = index;
      render();
    });
    return tab;
  }));
  button.addEventListener('click', async () => {
    const index = state.current;
    state.pending.add(index);
    render();
    if (!(await live.checkGap(index))) {
      state.pending.delete(index);
      render();
    }
  });

  Promise.all(['server.py', 'http_messages.py'].map(async file => [file, diffOps(await lines(`solution/${file}`), await lines(`broken/${file}`))]))
    .then(entries => {
      const ops = Object.fromEntries(entries);
      state.hunks = GAPS.map(gap => hunk(ops[gap.file], gap.markers));
      render();
    })
    .catch(() => toast('Не удалось загрузить сломанную копию'));

  fetch('data/broken.json').then(response => response.json()).then(results => {
    const max = results.groups.reduce((sum, group) => sum + group.max, 0);
    const note = document.getElementById('gaps-note');
    note.replaceChildren(document.createTextNode(`Сломанная копия запущена рядом с нашим server.py, в ней все пять поломок сразу. На официальном прогоне она набрала ${results.score} из ${max}, `));
    note.append(Object.assign(document.createElement('a'), { href: 'data/logs/broken.log', textContent: 'вот лог' }), document.createTextNode('. Кнопка шлёт обеим одинаковые запросы, как в тестах и на дыру.'));
  }).catch(() => {});

  render();
  return {
    all(results, available) {
      state.enabled = available;
      state.results = GAPS.map((_, index) => results[index] || null);
      state.pending.clear();
      render();
    },
    one(index, result) {
      state.results[index] = result;
      state.pending.delete(index);
      render();
    }
  };
}

setupTheme();
setupNavigation();
for (const card of CARDS) loadCode(card).catch(() => toast('Не удалось загрузить код решения'));
loadResults();
let board = null;
const share = state => board && board.send(state);
const memory = fetch('data/memory.json').then(response => response.json());
memory.then(renderMemory).catch(() => toast('Не удалось загрузить замеры памяти'));
const labs = memory.then(data => mountLabs(share, data)).catch(() => {
  toast('Не удалось загрузить лабы');
  return { apply() {}, restore() {} };
});
let gaps = null;
const live = mountLive(() => board, {
  gaps: (results, available) => gaps && gaps.all(results, available),
  gap: (index, result) => gaps && gaps.one(index, result)
});
gaps = mountGaps(live);
gaps.all({}, false);
board = startBoard({
  lab: state => labs.then(controller => controller.apply(state)),
  restore: data => {
    labs.then(controller => controller.restore(data.labs || {}, data.now));
    live.restore(data.live || null);
  },
  events: { live: data => live.event(data) }
});
mountSketches({ ...SKETCHES, ...DRAWINGS }, {
  top: 'http-hero',
  live: 'folder',
  bounds: 'scissors',
  large: 'crate',
  gzip: 'press',
  launch: 'plug',
  gaps: 'bug',
  results: 'trophy',
  'board-section': 'pencil'
});
mark(document.querySelector('h1 .mark'), 'circle', 700);
markVerdicts();
