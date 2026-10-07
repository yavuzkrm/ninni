// Applies the saved theme before first paint so the page doesn't flash.
try {
  const t = localStorage.getItem('ninni-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  // storage unavailable: follow the system theme
}
