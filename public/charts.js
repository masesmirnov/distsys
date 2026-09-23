const number = new Intl.NumberFormat('ru-RU');
const format = value => number.format(value);
const SVG = 'http://www.w3.org/2000/svg';

const GUARANTEES = ['AMO', 'ALO', 'EO', 'EOO'];
const METRICS = [
  ['send', 'Память Sender', 'байт'],
  ['recv', 'Память Receiver', 'байт'],
  ['messages', 'Сообщений в сети', ''],
  ['traffic', 'Трафик', 'байт']
];

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(rows, n) {
  return rows ? rows.find(item => item.n === n) : undefined;
}

function rowsOf(variant, guarantee, kind) {
  const block = variant.overhead[guarantee];
  return block && block[kind] ? block[kind].rows : [];
}

function statusNode(ok, text) {
  const node = html('span', 'status ' + (ok ? 'ok' : 'fail'));
  node.innerHTML = `<svg aria-hidden="true"><use href="#i-${ok ? 'check' : 'x'}"/></svg>`;
  node.append(document.createTextNode(text));
  return node;
}

const tooltip = {
  node: null,
  show(event, lines) {
    this.node = this.node || document.getElementById('tooltip');
    this.node.replaceChildren();
    lines.forEach((line, index) => {
      const part = index === 0 ? html('strong', '', line) : html('div', 'muted', line);
      this.node.append(part);
    });
    this.move(event);
    this.node.classList.add('shown');
  },
  move(event) {
    if (!this.node) return;
    const x = Math.min(window.innerWidth - this.node.offsetWidth - 12, event.clientX + 14);
    this.node.style.left = `${Math.max(12, x)}px`;
    this.node.style.top = `${event.clientY + 16}px`;
  },
  hide() {
    if (this.node) this.node.classList.remove('shown');
  }
};

function values(results) {
  return {
    passed: results.summary.passed,
    total: results.summary.total,
    score: format(results.summary.score),
    image: results.image
  };
}

function storageChart(root, results, n) {
  const limit = results.limits.AMO.FAULTY[String(n)].recv;
  const strategies = [
    { name: "array('i') — решение", source: results, chosen: true },
    { name: 'list', source: results.variants['holes-list'] },
    { name: 'set дырок', source: results.variants['holes-set'] },
    { name: 'set всех номеров', source: results.variants['all-ids'] }
  ].map(item => {
    const found = row(rowsOf(item.source, 'AMO', 'FAULTY'), n);
    return { ...item, value: found ? found.recv : null };
  });
  const top = Math.max(limit, ...strategies.map(item => item.value || 0)) * 1.12;
  const width = 560;
  const left = 150;
  const right = 24;
  const band = 42;
  const head = 26;
  const height = head + strategies.length * band + 26;
  const scale = value => left + (value / top) * (width - left - right);

  root.replaceChildren();
  root.append(html('div', 'chart-title', `${format(n)} писем`), html('div', 'chart-sub', `лимит ${format(limit)} байт`));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Память получателя AMO на ${n} письмах по вариантам хранения` });
  const magnitude = 10 ** Math.floor(Math.log10(top / 4));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(value => value * 4 >= top);
  for (let value = 0; value <= top; value += step) {
    const x = scale(value);
    chart.append(svg('line', { class: 'grid', x1: x, x2: x, y1: head - 6, y2: height - 22 }));
    chart.append(svg('text', { class: 'tick', x, y: height - 6, 'text-anchor': 'middle' }, value ? format(value) : '0'));
  }
  strategies.forEach((item, index) => {
    const y = head + index * band;
    chart.append(svg('text', { class: 'label' + (item.chosen ? '' : ' muted'), x: 0, y: y + band / 2 + 4 }, item.name));
    if (item.value === null) {
      chart.append(svg('text', { class: 'value', x: left + 6, y: y + band / 2 + 4 }, 'не дошёл: упал уже на 100 письмах'));
      return;
    }
    const barHeight = 18;
    const x2 = scale(item.value);
    const bar = svg('rect', {
      class: 'bar' + (item.chosen ? ' chosen' : ''),
      x: left,
      y: y + (band - barHeight) / 2,
      width: Math.max(2, x2 - left),
      height: barHeight,
      rx: 4,
      tabindex: 0
    });
    const passed = item.value <= limit;
    const lines = [`${format(item.value)} байт`, item.name, passed ? `в лимите ${format(limit)}` : `выше лимита ${format(limit)} — тест не прошёл`];
    bar.addEventListener('pointermove', event => tooltip.show(event, lines));
    bar.addEventListener('pointerleave', () => tooltip.hide());
    bar.addEventListener('focus', () => {
      const box = bar.getBoundingClientRect();
      tooltip.show({ clientX: box.right, clientY: box.top }, lines);
    });
    bar.addEventListener('blur', () => tooltip.hide());
    chart.append(bar);
    const label = svg('text', { class: 'value', x: x2 + 6, y: y + band / 2 + 4 }, format(item.value) + (passed ? '' : ' ✕'));
    if (x2 + 70 > width) {
      label.setAttribute('x', x2 - 6);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'value');
      label.style.fill = '#fff';
    }
    chart.append(label);
  });
  const limitX = scale(limit);
  chart.append(svg('line', { class: 'limit', x1: limitX, x2: limitX, y1: head - 10, y2: height - 22 }));
  chart.append(svg('text', { class: 'limit-label', x: limitX + 4, y: head - 12 }, 'лимит'));
  root.append(chart);

  const details = html('details', 'table-view');
  details.append(html('summary', '', 'Таблицей'));
  const table = html('table');
  table.innerHTML = '<thead><tr><th>Вариант</th><th class="num">Байт</th><th>Итог</th></tr></thead>';
  const body = html('tbody');
  for (const item of strategies) {
    const line = html('tr');
    line.append(html('td', '', item.name), html('td', 'num', item.value === null ? '—' : format(item.value)));
    const cell = html('td');
    cell.append(item.value === null ? statusNode(false, 'упал раньше') : statusNode(item.value <= limit, item.value <= limit ? 'в лимите' : 'выше лимита'));
    line.append(cell);
    body.append(line);
  }
  table.append(body);
  details.append(table);
  root.append(details);
}

function delayTable(root, results) {
  const solution = { overhead: results.overhead, failures: [], tests: results.tests };
  const variants = [
    ['2.0', results.variants['delay-2.0']],
    ['3.0', results.variants['delay-3.0']],
    ['4.0', solution],
    ['5.0', results.variants['delay-5.0']],
    ['6.0', results.variants['delay-6.0']]
  ];
  const messagesLimit = results.limits.ALO.FAULTY['100'].messages;
  const memoryLimit = results.limits.EOO.FAULTY['1000'].recv;
  const earlyLimit = results.limits.EOO.FAULTY['100'].recv;
  const table = html('table');
  table.innerHTML = `<thead><tr><th class="num">задержка</th><th>нормальная сеть</th><th class="num">сообщений · 100 писем · ≤ ${format(messagesLimit)}</th><th class="num">буфер EOO · 1000 писем · ≤ ${format(memoryLimit)}</th><th>итог</th></tr></thead>`;
  const body = html('tbody');
  for (const [delay, variant] of variants) {
    const line = html('tr', delay === '4.0' ? 'current' : '');
    line.append(html('td', 'num', delay));
    const normal = variant.tests.find(test => test.g === 'ALO' && test.name === 'NORMAL');
    const sent = normal && /Sender sent (\d+)/.exec(normal.status || '');
    const normalCell = html('td');
    normalCell.append(sent ? statusNode(false, `${sent[1]} отправок`) : statusNode(true, 'повторов нет'));
    line.append(normalCell);
    const messages = row(rowsOf(variant, 'ALO', 'FAULTY'), 100);
    const messagesCell = html('td', 'num');
    messagesCell.append(statusNode(messages.messages <= messagesLimit, format(messages.messages)));
    line.append(messagesCell);
    const memory = row(rowsOf(variant, 'EOO', 'FAULTY'), 1000);
    const early = row(rowsOf(variant, 'EOO', 'FAULTY'), 100);
    const memoryCell = html('td', 'num');
    if (memory) memoryCell.append(statusNode(memory.recv <= memoryLimit, format(memory.recv)));
    else if (early && early.recv > earlyLimit) memoryCell.append(statusNode(false, `${format(early.recv)} уже на 100 письмах`));
    else memoryCell.append(html('span', 'muted', 'тест остановился раньше'));
    line.append(memoryCell);
    const total = html('td');
    total.append(variant.failures.length ? statusNode(false, `не прошло: ${variant.failures.length}`) : statusNode(true, 'всё прошло'));
    line.append(total);
    body.append(line);
  }
  table.append(body);
  root.replaceChildren(table);
}

function meters(root, results) {
  root.replaceChildren();
  for (const guarantee of GUARANTEES) {
    const card = html('div', 'card');
    card.append(html('h3', '', guarantee));
    const list = html('div', 'meter');
    list.style.marginTop = '14px';
    const rows = rowsOf(results, guarantee, 'FAULTY');
    for (const [key, label] of METRICS) {
      let worst = null;
      for (const item of rows) {
        const limit = results.limits[guarantee].FAULTY[String(item.n)];
        if (!limit) continue;
        const share = item[key] / limit[key];
        if (!worst || share > worst.share) worst = { share, value: item[key], limit: limit[key], n: item.n };
      }
      const line = html('div', 'meter-row');
      line.append(html('span', '', label));
      const track = html('div', 'meter-track');
      const fill = html('div', 'meter-fill');
      fill.style.width = `${Math.min(100, worst.share * 100).toFixed(1)}%`;
      track.append(fill);
      track.title = `${format(worst.value)} из ${format(worst.limit)} на ${format(worst.n)} письмах`;
      line.append(track, html('span', 'meter-value', `${format(worst.value)} / ${format(worst.limit)}`));
      list.append(line);
    }
    card.append(list);
    root.append(card);
  }
}

function overheadTable(root, results) {
  const table = html('table');
  table.innerHTML = '<thead><tr><th>Гарантия</th><th>Сеть</th><th class="num">Писем</th><th class="num">Sender, байт</th><th class="num">Receiver, байт</th><th class="num">Сообщений</th><th class="num">Трафик</th><th class="num">Пропускная</th></tr></thead>';
  const body = html('tbody');
  for (const guarantee of GUARANTEES) {
    for (const kind of ['NORMAL', 'FAULTY']) {
      for (const item of rowsOf(results, guarantee, kind)) {
        const limit = results.limits[guarantee][kind][String(item.n)];
        const cell = (value, key) => {
          const text = format(value);
          return limit ? `${text} <span class="muted">/ ${format(limit[key])}</span>` : text;
        };
        const line = html('tr');
        line.innerHTML = `<td>${guarantee}</td><td>${kind === 'NORMAL' ? 'нормальная' : 'с отказами'}</td><td class="num">${format(item.n)}</td><td class="num">${cell(item.send, 'send')}</td><td class="num">${cell(item.recv, 'recv')}</td><td class="num">${cell(item.messages, 'messages')}</td><td class="num">${cell(item.traffic, 'traffic')}</td><td class="num">${number.format(item.throughput)}${limit ? ` <span class="muted">≥ ${number.format(limit.throughput)}</span>` : ''}</td>`;
        body.append(line);
      }
    }
  }
  table.append(body);
  root.replaceChildren(table);
  const note = html('p', 'fine', 'для 500 писем тесты лимитов не задают');
  note.style.padding = '10px 12px 4px';
  note.style.margin = '0';
  root.append(note);
}

function testsGrid(root, results) {
  root.replaceChildren();
  for (const guarantee of GUARANTEES) {
    const card = html('div', 'card');
    card.append(html('h3', '', guarantee));
    const list = html('ul');
    for (const test of results.tests.filter(item => item.g === guarantee)) {
      const item = html('li', test.status === 'PASSED' ? '' : 'failed');
      item.innerHTML = `<svg aria-hidden="true"><use href="#i-${test.status === 'PASSED' ? 'check' : 'x'}"/></svg>`;
      item.append(document.createTextNode(test.name));
      list.append(item);
    }
    card.append(list);
    root.append(card);
  }
}

export function renderResults(results) {
  const bound = values(results);
  for (const node of document.querySelectorAll('[data-value]')) {
    const value = bound[node.dataset.value];
    if (value !== undefined) node.textContent = value;
  }
  storageChart(document.getElementById('chart-storage-100'), results, 100);
  storageChart(document.getElementById('chart-storage-1000'), results, 1000);
  delayTable(document.getElementById('delay-table'), results);
  meters(document.getElementById('meters'), results);
  overheadTable(document.getElementById('overhead-table'), results);
  testsGrid(document.getElementById('tests-grid'), results);
  window.addEventListener('scroll', () => tooltip.hide(), { passive: true });
}
