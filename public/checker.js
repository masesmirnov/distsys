const PRESETS = {
  trap: { sent: ['X', 'Y', 'X'], delivered: ['X', 'X', 'Y'], violation: true },
  fair: { sent: ['X', 'Y', 'X'], delivered: ['X', 'Y', 'X'], violation: false },
  swap: { sent: ['A', 'B', 'C'], delivered: ['B', 'A', 'C'], violation: true }
};

const TITLES = {
  original: ['как в тестах', 'совпало → next_idx на месте'],
  fixed: ['с фиксом', 'совпало → next_idx += 1']
};

class Machine {
  constructor(sent, delivered, fixed) {
    this.sent = sent;
    this.delivered = delivered;
    this.fixed = fixed;
    this.i = 0;
    this.next = 0;
    this.matches = [];
    this.result = null;
    this.log = '&nbsp;';
  }

  step() {
    if (this.result) return;
    if (this.i >= this.delivered.length) {
      this.result = { violation: false, text: 'Ok' };
      this.log = 'все delivered нашлись по порядку';
      return;
    }
    if (this.next >= this.sent.length) {
      const before = this.i > 0 ? this.delivered[this.i - 1] : '—';
      this.result = { violation: true, text: `Order violation: ${this.delivered[this.i]} after ${before}` };
      this.log = `sent кончился, <b>delivered[${this.i}]</b> не найден`;
      return;
    }
    const message = this.delivered[this.i];
    const candidate = this.sent[this.next];
    if (message === candidate) {
      this.matches.push({ i: this.i, next: this.next });
      this.log = `<b>delivered[${this.i}] = sent[${this.next}]</b> → next_idx = ${this.fixed ? this.next + 1 : this.next}`;
      if (this.fixed) this.next += 1;
      this.i += 1;
    } else {
      this.log = `<b>delivered[${this.i}] ≠ sent[${this.next}]</b> → next_idx = ${this.next + 1}`;
      this.next += 1;
    }
  }
}

function tokens(values, role, machine) {
  const row = document.createElement('div');
  row.className = 'seq-row';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role;
  row.append(who);
  values.forEach((value, index) => {
    const token = document.createElement('span');
    token.className = 'token';
    token.textContent = value;
    const label = document.createElement('span');
    label.className = 'idx';
    label.textContent = index;
    token.append(label);
    if (role === 'sent') {
      if (index === machine.next && !machine.result) token.classList.add('pointer');
      if (machine.matches.some(match => match.next === index)) token.classList.add('matched');
    } else {
      if (index === machine.i && !machine.result) token.classList.add('current');
      if (machine.matches.some(match => match.i === index)) token.classList.add('matched');
      if (machine.result && machine.result.violation && index === machine.i) token.classList.add('failed');
    }
    row.append(token);
  });
  return row;
}

function render(card, machine, preset, kind) {
  card.replaceChildren();
  const title = document.createElement('div');
  title.className = 'check-title';
  const heading = document.createElement('h3');
  heading.textContent = TITLES[kind][0];
  const sub = document.createElement('code');
  sub.textContent = TITLES[kind][1];
  title.append(heading, sub);
  const log = document.createElement('div');
  log.className = 'check-log';
  log.innerHTML = machine.log;
  card.append(title, tokens(machine.sent, 'sent', machine), tokens(machine.delivered, 'delivered', machine), log);
  if (machine.result) {
    const correct = machine.result.violation === preset.violation;
    const result = document.createElement('div');
    result.className = 'check-result';
    const code = document.createElement('code');
    code.textContent = machine.result.text;
    const verdict = document.createElement('span');
    verdict.className = 'status ' + (correct ? 'ok' : 'fail');
    verdict.innerHTML = `<svg aria-hidden="true"><use href="#i-${correct ? 'check' : 'x'}"/></svg>`;
    verdict.append(document.createTextNode(correct ? 'верно' : preset.violation ? 'нарушение пропущено' : 'ложная тревога'));
    result.append(code, document.createTextNode(' '), verdict);
    card.append(result);
  }
}

export function mountChecker() {
  const select = document.getElementById('checker-preset');
  const cards = { original: document.querySelector('[data-checker="original"]'), fixed: document.querySelector('[data-checker="fixed"]') };
  if (!select || !cards.original || !cards.fixed) return;
  let machines;
  let timer = 0;
  const reset = () => {
    clearInterval(timer);
    timer = 0;
    const preset = PRESETS[select.value];
    machines = {
      original: new Machine(preset.sent, preset.delivered, false),
      fixed: new Machine(preset.sent, preset.delivered, true)
    };
    draw();
  };
  const draw = () => {
    const preset = PRESETS[select.value];
    render(cards.original, machines.original, preset, 'original');
    render(cards.fixed, machines.fixed, preset, 'fixed');
  };
  const step = () => {
    machines.original.step();
    machines.fixed.step();
    draw();
    return machines.original.result && machines.fixed.result;
  };
  document.getElementById('checker-step').addEventListener('click', () => {
    clearInterval(timer);
    timer = 0;
    step();
  });
  document.getElementById('checker-run').addEventListener('click', () => {
    if (timer) return;
    if (machines.original.result && machines.fixed.result) reset();
    timer = setInterval(() => {
      if (step()) {
        clearInterval(timer);
        timer = 0;
      }
    }, 650);
  });
  document.getElementById('checker-reset').addEventListener('click', reset);
  select.addEventListener('change', reset);
  reset();
}
