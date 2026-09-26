import { mountRaces } from './races.js';
import { startBoard, toast } from './board.js';
import { mountChat } from './chat.js';
import { highlight } from './code.js';
import { setupNavigation, setupTheme } from './page.js';
import { mark, markOnSight, markVerdicts, mountSketches } from './ink.js';
import { SKETCHES } from './sketches.js';

const PROTO = {
  keywords: new Set(['syntax', 'package', 'import', 'message', 'service', 'rpc', 'returns', 'stream']),
  builtins: new Set(['string']),
  definers: new Set(['message', 'service', 'rpc'])
};

const PROTO_TAGS = {
  3: 'пакет из условия',
  5: 'пустой запрос',
  6: 'время до наносекунд',
  8: 'запрос',
  13: 'ответ',
  17: 'то, что идёт в поток',
  24: 'унарный',
  25: 'поток с сервера'
};

async function loadProto() {
  const holder = document.getElementById('proto-code');
  try {
    const response = await fetch('solution/proto/messenger.proto');
    const lines = (await response.text()).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
    const pre = document.createElement('pre');
    pre.className = 'code';
    lines.forEach((text, index) => {
      const row = document.createElement('span');
      row.className = 'ln';
      row.innerHTML = `<span class="no">${index + 1}</span><span class="src">${highlight(text, PROTO) || ' '}</span>`;
      const tag = PROTO_TAGS[index + 1];
      if (tag) row.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: tag }));
      pre.append(row);
    });
    holder.replaceChildren(pre);
  } catch {
    toast('Не удалось загрузить messenger.proto');
  }
}

async function loadResults() {
  try {
    const response = await fetch('data/results.json');
    const results = await response.json();
    document.getElementById('tests-grid').replaceChildren(...results.components.map(component => {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('h3');
      title.textContent = component.name;
      const score = document.createElement('span');
      score.className = 'status ' + (component.score === component.max ? 'ok' : 'fail');
      score.textContent = `${component.score}/${component.max}`;
      title.append(score);
      const list = document.createElement('ul');
      for (const test of component.tests) {
        const item = document.createElement('li');
        if (test.status !== 'PASSED') item.className = 'failed';
        item.innerHTML = `<svg aria-hidden="true"><use href="#i-${test.status === 'PASSED' ? 'check' : 'x'}"/></svg>`;
        item.append(document.createTextNode(test.name.replace(/^test_/, '')));
        list.append(item);
      }
      card.append(title, list);
      return card;
    }));
    document.querySelector('[data-value="image"]').textContent = results.image;
    markOnSight(Array.from(document.querySelectorAll('.results-grid h3 .status')), 'circle');
  } catch {
    toast('Не удалось загрузить результаты тестов');
  }
}

setupTheme();
setupNavigation();
loadProto();
loadResults();
let board = null;
const share = state => board && board.send(state);
const races = mountRaces(share).catch(() => {
  toast('Не удалось загрузить код решения');
  return { apply() {}, restore() {} };
});
const chat = mountChat(() => board);
board = startBoard({
  lab: state => races.then(controller => controller.apply(state)),
  restore: data => {
    races.then(controller => controller.restore(data.labs || {}, data.now));
    chat.restore(data.chat || null);
  },
  events: { chat: data => chat.event(data) }
});
mountSketches(SKETCHES, {
  top: 'messenger-hero',
  chat: 'server',
  proto: 'contract',
  send: 'padlock',
  subscribe: 'antenna',
  flush: 'mailbox',
  reconnect: 'plug',
  results: 'trophy',
  'board-section': 'pencil'
});
mark(document.querySelector('h1 .mark'), 'circle', 700);
markVerdicts();
