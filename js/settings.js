const KEY = 'reader.settings';

export const THEMES = ['light', 'sepia', 'dark'];

export const FONTS = {
  serif: { label: 'Serif', stack: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  sans: { label: 'Sans-serif', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  book: { label: 'Book', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace' },
};

const DEFAULTS = {
  theme: 'light',
  font: 'serif',
  fontSize: 18,      // px
  lineHeight: 1.5,
  zoom: 'fit',       // 'fit' or a percentage number
  sidebar: true,
  pageNumbers: true,
};

let cache;

export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode */ }
    cache = { ...DEFAULTS, ...stored };
  }
  return cache;
}

export function setSettings(patch) {
  cache = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return cache;
}
