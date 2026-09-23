(() => {
  let theme = null;
  try {
    theme = localStorage.getItem('theme');
  } catch {
    theme = null;
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
})();
