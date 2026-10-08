const KEY = 'sr.settings';

export const PANIC_TARGETS = {
  m365: { label: 'Microsoft 365 home', url: 'https://www.microsoft365.com/' },
  onedrive: { label: 'OneDrive', url: 'https://onedrive.live.com/' },
  outlook: { label: 'Outlook', url: 'https://outlook.office.com/mail/' },
  custom: { label: 'Custom address', url: '' },
};

const DEFAULTS = {
  panicKey: 'double',      // 'double' | 'single' | 'off'
  panicTarget: 'm365',
  panicUrl: '',
  initials: '',
  font: 'Aptos',
  fontSize: 11,
  zoom: 100,
  navOpen: true,
  plain: false,
  showProgress: true,
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

export function panicUrl() {
  const s = getSettings();
  if (s.panicTarget === 'custom' && /^https?:\/\//i.test(s.panicUrl)) return s.panicUrl;
  return (PANIC_TARGETS[s.panicTarget] || PANIC_TARGETS.m365).url || PANIC_TARGETS.m365.url;
}
