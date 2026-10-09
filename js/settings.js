const KEY = 'reader.settings';

export const THEMES = {
  light: { label: 'White' },
  sepia: { label: 'Sepia' },
  dark: { label: 'Dark' },
};

// Only fonts that ship with common operating systems (the CSP blocks web
// fonts); each stack falls back to a metric-compatible or similar face.
export const FONTS = {
  georgia: { label: 'Georgia', stack: 'Georgia, "DejaVu Serif", serif' },
  serif: { label: 'Charter', stack: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  times: { label: 'Times New Roman', stack: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif' },
  book: { label: 'Palatino', stack: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", "Iowan Old Style", Georgia, serif' },
  garamond: { label: 'Garamond', stack: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "Cormorant Garamond", Georgia, serif' },
  cambria: { label: 'Cambria', stack: 'Cambria, Caladea, Georgia, serif' },
  sans: { label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  calibri: { label: 'Calibri', stack: 'Calibri, Carlito, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  arial: { label: 'Arial', stack: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
  verdana: { label: 'Verdana', stack: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  courier: { label: 'Courier New', stack: '"Courier New", Courier, "Liberation Mono", monospace' },
  mono: { label: 'Monospace', stack: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace' },
};

/** Font sizes offered in the size box, in points (as in a word processor). */
export const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36];

/** Line spacing multiples; 1.0 ("single") maps to a CSS line-height of 1.2. */
export const SPACINGS = [1, 1.15, 1.5, 2, 2.5];

// Page sizes and margins in CSS px at 96dpi.
export const PAGE_SIZES = {
  letter: { label: 'Letter', desc: '8.5" × 11"', w: 816, h: 1056 },
  a4: { label: 'A4', desc: '21 cm × 29.7 cm', w: 794, h: 1123 },
  trade: { label: 'Trade', desc: '6" × 9"', w: 576, h: 864 },
  a5: { label: 'A5', desc: '14.8 cm × 21 cm', w: 559, h: 794 },
};

export const MARGINS = {
  normal: { label: 'Normal', desc: '1" all sides', v: 96, h: 96 },
  narrow: { label: 'Narrow', desc: '0.5" all sides', v: 48, h: 48 },
  moderate: { label: 'Moderate', desc: '1" top and bottom, 0.75" sides', v: 96, h: 72 },
  wide: { label: 'Wide', desc: '1" top and bottom, 1.5" sides', v: 96, h: 144 },
};

const DEFAULTS = {
  theme: 'light',
  font: 'georgia',
  fontPt: 12,
  spacing: 1.15,
  align: 'left',       // 'left' | 'justify'
  para: 'spaced',      // 'spaced' | 'indented'
  pageSize: 'letter',
  margins: 'normal',
  zoom: 'auto',        // 'auto' | 'fit' | 'page' | a percentage
  sidebar: true,
  pageNumbers: true,   // header and footer
  ribbon: true,        // ribbon expanded
};

let cache;
let stored = null;

export function getSettings() {
  if (!cache) {
    try { stored = JSON.parse(localStorage.getItem(KEY)); } catch { /* private mode */ }
    cache = { ...DEFAULTS, ...(stored || {}) };
    if (!FONTS[cache.font]) cache.font = DEFAULTS.font;
    if (!PAGE_SIZES[cache.pageSize]) cache.pageSize = DEFAULTS.pageSize;
    if (!MARGINS[cache.margins]) cache.margins = DEFAULTS.margins;
    if (!THEMES[cache.theme]) cache.theme = DEFAULTS.theme;
    if (!(cache.fontPt >= 6 && cache.fontPt <= 72)) cache.fontPt = DEFAULTS.fontPt;
  }
  return cache;
}

/** True once the reader has saved any settings on this device. */
export function hasStoredSettings() {
  getSettings();
  return stored != null;
}

export function setSettings(patch) {
  cache = { ...getSettings(), ...patch };
  stored = cache;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return cache;
}
