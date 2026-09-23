import { mountLabs } from './sim.js';
import { startBoard, toast } from './board.js';
import { renderResults } from './charts.js';
import { mountChecker } from './checker.js';

function setupTheme() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      return;
    }
  });
}

function setupNavigation() {
  const links = new Map(Array.from(document.querySelectorAll('.nav a'), link => [link.getAttribute('href').slice(1), link]));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id === 'board-section' ? 'board' : entry.target.id;
      for (const [key, link] of links) link.classList.toggle('current', key === id);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('section.chapter').forEach(section => observer.observe(section));
}

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
  restore: (states, saved, now) => {
    labs.then(controller => controller.restore(states, now));
    checker.restore(saved, now);
  }
});
