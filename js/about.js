// Match the reader's page colour on the About page.
try {
  const theme = JSON.parse(localStorage.getItem('reader.settings'))?.theme;
  if (theme === 'sepia' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* defaults */ }
