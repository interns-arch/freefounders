// Applies the saved theme before first paint (no flash). Kept external for a strict CSP.
try {
  var t = localStorage.getItem('eam-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
