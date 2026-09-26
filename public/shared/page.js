export function setupTheme() {
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

export function setupNavigation() {
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
