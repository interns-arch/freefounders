// Dark mode before the first paint (no flash): the saved choice, else the device setting.
try {
  var t = localStorage.getItem('ff-theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
