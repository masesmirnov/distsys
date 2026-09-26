import { mountLabs } from './sim.js';
import { startBoard, toast } from './board.js';
import { renderResults } from './charts.js';
import { mountChecker } from './checker.js';
import { setupNavigation, setupTheme } from './page.js';
import { mark, markVerdicts, mountSketches } from './ink.js';
import { SKETCHES } from './sketches.js';

async function loadResults() {
  try {
    const response = await fetch('data/results.json');
    renderResults(await response.json());
  } catch {
    toast('Не удалось загрузить результаты тестов');
  }
}

setupTheme();
setupNavigation();
loadResults();
let board = null;
const share = state => board && board.send(state);
const checker = mountChecker(share);
const labs = mountLabs(share);
board = startBoard({
  lab: state => labs.then(controller => controller.apply(state)),
  checker: state => checker.apply(state),
  restore: data => {
    labs.then(controller => controller.restore(data.labs || {}, data.now));
    checker.restore(data.checker || null, data.now);
  }
});
mountSketches(SKETCHES, {
  top: 'airmail-hero',
  model: 'storm',
  amo: 'once',
  alo: 'retry',
  eo: 'stamp',
  eoo: 'ordered',
  resources: 'gauge',
  bug: 'bug',
  results: 'trophy',
  'board-section': 'pencil'
});
mark(document.querySelector('h1 .mark'), 'underline', 700);
markVerdicts();
