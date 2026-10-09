import { icons } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Word-style modal dialog. Resolves with the id of the clicked button (or null). */
export function dialog({ title, body, buttons = [{ id: 'ok', label: 'OK', primary: true }], onOpen, width = 440 }) {
  return new Promise((resolve) => {
    const el = h(`
      <div class="ui-backdrop" role="presentation">
        <div class="ui-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="width:min(${width}px, calc(100vw - 32px))">
          <div class="ui-dialog-head">
            <h2>${esc(title)}</h2>
            <button class="icon-btn" data-close aria-label="Close">${icons.close}</button>
          </div>
          <div class="ui-dialog-body"></div>
          <div class="ui-dialog-foot">
            ${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-id="${b.id}">${esc(b.label)}</button>`).join('')}
          </div>
        </div>
      </div>`);
    const bodyEl = el.querySelector('.ui-dialog-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.append(body);
    const close = (id) => {
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve(id);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); close(primary.id); }
      }
    };
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-close]')) close(null);
      const b = e.target.closest('[data-id]');
      if (b) close(b.dataset.id);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(el);
    onOpen?.(el);
    (el.querySelector('input, select') || el.querySelector('.btn.primary'))?.focus();
  });
}

export async function promptText(title, label, value) {
  let input;
  const id = await dialog({
    title,
    body: `<label class="field"><span>${esc(label)}</span><input type="text" value="${esc(value)}" spellcheck="false"></label>`,
    buttons: [{ id: 'ok', label: 'OK', primary: true }, { id: 'cancel', label: 'Cancel' }],
    onOpen: (el) => { input = el.querySelector('input'); setTimeout(() => input.select()); },
  });
  return id === 'ok' ? input.value.trim() : null;
}

/** Small popup menu anchored to `anchor`. items: [{label, icon, action}] */
export function popupMenu(anchor, items, { align = 'left' } = {}) {
  document.querySelector('.ui-menu')?.remove();
  const menu = h(`<div class="ui-menu" role="menu">${items.map((it, i) => it === '-'
    ? '<div class="ui-menu-sep"></div>'
    : `<button role="menuitem" data-i="${i}"${it.disabled ? ' class="disabled" disabled aria-disabled="true"' : ''}>${it.icon ? icons[it.icon] || it.icon : '<span class="ui-menu-gap"></span>'}<span>${esc(it.label)}</span></button>`).join('')}</div>`);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const left = align === 'right' ? r.right - mw : r.left;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - mw - 8))}px`;
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    close();
    items[b.dataset.i].action?.();
  });
  (menu.querySelector('button:not(:disabled)') || menu).focus();
  return close;
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.ui-toast');
  if (!el) {
    el = h('<div class="ui-toast" role="status"></div>');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function relativeTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const mins = Math.round((now - d) / 60000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
