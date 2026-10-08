const s = (body) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  logo: s('<path d="M4 5.5c2.7-1.2 5.4-1.2 8 .9 2.6-2.1 5.3-2.1 8-.9v13c-2.7-1.2-5.4-1.2-8 .9-2.6-2.1-5.3-2.1-8-.9z"/><path d="M12 6.4v13"/>'),
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  contents: s('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  search: s('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  settings: s('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  fit: s('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  upload: s('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  trash: s('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  open: s('<path d="M4 5.5c2.7-1.2 5.4-1.2 8 .9 2.6-2.1 5.3-2.1 8-.9v13c-2.7-1.2-5.4-1.2-8 .9-2.6-2.1-5.3-2.1-8-.9z"/>'),
  prev: s('<path d="M18 15l-6-6-6 6"/>'),
  next: s('<path d="M6 9l6 6 6-6"/>'),
};
