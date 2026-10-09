// Quick exit: a keyboard shortcut that immediately replaces the reader with
// another website (Microsoft 365 by default). location.replace() is used so
// the Back button does not return to the reader from that tab.

const KEY = 'reader.quickExit';

export const OFFICE_URL = 'https://www.office.com/';

export const SHORTCUTS = {
  esc3: 'Esc three times quickly',
  altX: 'Alt + X',
  f9: 'F9',
};

const DEFAULTS = { enabled: true, target: 'office', url: '', key: 'esc3' };

export function getQuickExit() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode */ }
  const cfg = { ...DEFAULTS, ...stored };
  if (!SHORTCUTS[cfg.key]) cfg.key = DEFAULTS.key;
  if (cfg.target !== 'custom') cfg.target = 'office';
  return cfg;
}

export function setQuickExit(patch) {
  const cfg = { ...getQuickExit(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  return cfg;
}

/** Normalise a typed address to an http(s) URL, or return null if unusable. */
export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function exitUrl(cfg = getQuickExit()) {
  return (cfg.target === 'custom' && normalizeUrl(cfg.url)) || OFFICE_URL;
}

export function quickExit() {
  location.replace(exitUrl());
}

/** Listen for the configured shortcut on this page. */
export function installQuickExit() {
  let escTimes = [];
  addEventListener('keydown', (e) => {
    const cfg = getQuickExit();
    if (!cfg.enabled || e.repeat) return;
    let hit = false;
    if (cfg.key === 'esc3' && e.key === 'Escape') {
      const now = e.timeStamp;
      escTimes = [...escTimes.filter((t) => now - t < 900), now];
      hit = escTimes.length >= 3;
    } else if (cfg.key === 'altX') {
      hit = e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyX';
    } else if (cfg.key === 'f9') {
      hit = e.key === 'F9';
    }
    if (hit) {
      e.preventDefault();
      e.stopImmediatePropagation();
      quickExit();
    }
  }, true);
}
