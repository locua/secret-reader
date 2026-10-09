// Word-processor style EPUB reader: a ribbon of formatting controls, a
// navigation pane with the book's contents, and each section of the book laid
// out as a stack of printed pages.

import { openEpub, readMetadata } from './epub.js';
import { paginateChapter, createPage } from './paginate.js';
import * as db from './db.js';
import {
  getSettings, setSettings, hasStoredSettings, THEMES, FONTS, SIZES, SPACINGS, PAGE_SIZES, MARGINS,
} from './settings.js';
import { icons } from './icons.js';
import { h, esc, dialog, popupMenu, toast, relativeTime } from './ui.js';

const LAST_KEY = 'reader.last';
const LAYOUT_KEYS = ['font', 'fontPt', 'spacing', 'align', 'para', 'pageSize', 'margins'];
const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200];
const narrowMQ = matchMedia('(max-width: 760px)');

const state = {
  record: null,        // the book's IndexedDB record
  book: null,          // openEpub() result
  toc: [],
  ch: 0,               // section (spine item) on screen
  words: 0,
  pages: [],
  cache: new Map(),    // ch -> Promise<{nodes, words}>
  token: 0,            // render generation
  zoom: 1,
  navMobile: false,
  collapsed: new Set(),
  activeToc: -1,
  pendingAnchor: undefined,
  search: { query: '', results: [], ranges: [], texts: new Map(), token: 0 },
};

// ---------------------------------------------------------------------------
// Shell

const fontOptions = Object.entries(FONTS).map(([k, f]) =>
  `<option value="${k}" style="font-family:${esc(f.stack)}">${esc(f.label)}</option>`).join('');
const sizeOptions = SIZES.map((v) => `<option value="${v}">${v}</option>`).join('');

const app = document.getElementById('app');
app.className = 'app';
app.innerHTML = `
<header class="titlebar">
  <div class="tb-left"><span class="tb-logo">${icons.logo}</span><span class="tb-app">Reader</span></div>
  <div class="tb-title" id="doc-title"></div>
  <div class="tb-right"><span class="tb-note" title="Books are kept in this browser and never uploaded">Stored on this device</span></div>
</header>
<div class="tabs" role="tablist" aria-label="Ribbon tabs">
  <button class="tab tab-file" data-action="file">File</button>
  <button class="tab" role="tab" data-tab="home" aria-selected="true">Home</button>
  <button class="tab" role="tab" data-tab="layout" aria-selected="false">Layout</button>
  <button class="tab" role="tab" data-tab="view" aria-selected="false">View</button>
  <span class="tabs-spacer"></span>
  <button class="icon-btn ribbon-toggle" data-cmd="ribbon"></button>
</div>
<div class="ribbon" id="ribbon">
  <div class="panel" data-panel="home" role="tabpanel">
    <div class="group">
      <div class="group-body col">
        <div class="row">
          <select id="font-family" class="sel sel-font" title="Font" aria-label="Font">${fontOptions}</select>
          <select id="font-size" class="sel sel-size" title="Font Size" aria-label="Font size">${sizeOptions}</select>
        </div>
        <div class="row">
          <button class="rb" data-cmd="grow" title="Increase Font Size (Ctrl+])" aria-label="Increase font size">${icons.grow}</button>
          <button class="rb" data-cmd="shrink" title="Decrease Font Size (Ctrl+[)" aria-label="Decrease font size">${icons.shrink}</button>
          <span class="rb-sep"></span>
          <button class="rb rb-drop" data-menu="font" title="More fonts" aria-label="Font list">Aa${icons.dropdown}</button>
        </div>
      </div>
      <div class="group-label">Font</div>
    </div>
    <div class="group">
      <div class="group-body col">
        <div class="row">
          <button class="rb" data-cmd="align" data-value="left" title="Align Left" aria-label="Align left">${icons.alignLeft}</button>
          <button class="rb" data-cmd="align" data-value="justify" title="Justify" aria-label="Justify">${icons.justify}</button>
          <span class="rb-sep"></span>
          <button class="rb rb-drop" data-menu="spacing" title="Line and Paragraph Spacing" aria-label="Line spacing">${icons.spacing}${icons.dropdown}</button>
        </div>
        <div class="row">
          <button class="rb rb-text" data-cmd="para" title="Indent the first line of each paragraph instead of adding space after it">${icons.indent}<span>First-line indent</span></button>
        </div>
      </div>
      <div class="group-label">Paragraph</div>
    </div>
    <div class="group">
      <div class="group-body">
        <button class="rb big" data-cmd="prev" title="Previous section">${icons.bigPrev}<span>Previous<br>Section</span></button>
        <button class="rb big" data-cmd="next" title="Next section">${icons.bigNext}<span>Next<br>Section</span></button>
        <button class="rb big" data-cmd="nav" title="Show or hide the contents">${icons.bigNav}<span>Navigation<br>Pane</span></button>
      </div>
      <div class="group-label">Navigate</div>
    </div>
  </div>
  <div class="panel" data-panel="layout" role="tabpanel" hidden>
    <div class="group">
      <div class="group-body">
        <button class="rb big" data-menu="margins" title="Margins">${icons.bigMargins}<span>Margins ${icons.dropdown}</span></button>
        <button class="rb big" data-menu="size" title="Page size">${icons.bigSize}<span>Size ${icons.dropdown}</span></button>
      </div>
      <div class="group-label">Page Setup</div>
    </div>
    <div class="group">
      <div class="group-body">
        <button class="rb big" data-menu="color" title="Page color">${icons.bigColor}<span>Page<br>Color ${icons.dropdown}</span></button>
      </div>
      <div class="group-label">Page Background</div>
    </div>
    <div class="group">
      <div class="group-body col">
        <div class="row"><span class="rb-label">Line spacing</span><select id="spacing" class="sel" aria-label="Line spacing">${SPACINGS.map((v) => `<option value="${v}">${spacingLabel(v)}</option>`).join('')}</select></div>
        <div class="row"><span class="rb-label">Paragraphs</span><select id="para" class="sel" aria-label="Paragraph style"><option value="spaced">Space after</option><option value="indented">First-line indent</option></select></div>
      </div>
      <div class="group-label">Paragraph</div>
    </div>
  </div>
  <div class="panel" data-panel="view" role="tabpanel" hidden>
    <div class="group">
      <div class="group-body col checks">
        <label class="chk"><input type="checkbox" id="chk-nav"> Navigation Pane</label>
        <label class="chk"><input type="checkbox" id="chk-hf"> Header &amp; Footer</label>
        <label class="chk"><input type="checkbox" id="chk-ribbon"> Always show Ribbon</label>
      </div>
      <div class="group-label">Show</div>
    </div>
    <div class="group">
      <div class="group-body">
        <button class="rb big" data-menu="zoom" title="Zoom">${icons.zoomIn.replace('width="20" height="20"', 'width="30" height="30"')}<span>Zoom ${icons.dropdown}</span></button>
        <button class="rb big" data-cmd="zoom100" title="Zoom to 100%">${icons.big100}<span>100%</span></button>
        <button class="rb big" data-cmd="zoomPage" title="Fit a whole page in the window">${icons.bigOnePage}<span>One<br>Page</span></button>
        <button class="rb big" data-cmd="zoomWidth" title="Fit the page width to the window">${icons.bigWidth}<span>Page<br>Width</span></button>
      </div>
      <div class="group-label">Zoom</div>
    </div>
    <div class="group">
      <div class="group-body">
        <button class="rb big" data-menu="color" title="Page color">${icons.bigColor}<span>Page<br>Color ${icons.dropdown}</span></button>
      </div>
      <div class="group-label">Theme</div>
    </div>
  </div>
</div>
<div class="workspace">
  <aside class="navpane" id="navpane" aria-label="Navigation">
    <div class="np-head">
      <h2>Navigation</h2>
      <button class="icon-btn" data-cmd="nav" aria-label="Close navigation pane" title="Close">${icons.close}</button>
    </div>
    <div class="np-search">
      ${icons.search}
      <input type="search" id="search" placeholder="Search document" aria-label="Search document" autocomplete="off" spellcheck="false">
    </div>
    <div class="np-sub"><span id="np-label">Headings</span><span id="np-count"></span></div>
    <div class="np-body" id="np-body">
      <div class="toc" id="toc" role="tree" aria-label="Contents"></div>
      <div class="results" id="results" hidden></div>
    </div>
  </aside>
  <div class="nav-scrim" data-cmd="nav"></div>
  <main class="canvas" id="canvas" tabindex="-1" aria-label="Document">
    <div class="doc" id="doc"></div>
    <div class="doc-nav" id="doc-nav"></div>
  </main>
  <div class="busy" id="busy" hidden><span class="spinner"></span><span>Laying out pages…</span></div>
</div>
<footer class="statusbar">
  <button class="sb-item sb-btn-text" id="sb-section" data-cmd="nav" title="Show the contents"></button>
  <span class="sb-item" id="sb-page"></span>
  <span class="sb-item sb-wide" id="sb-words"></span>
  <span class="sb-item sb-wide" id="sb-lang"></span>
  <span class="sb-spacer"></span>
  <button class="sb-btn" data-cmd="nav" title="Navigation Pane" aria-label="Navigation pane">${icons.navPane}</button>
  <div class="sb-zoom">
    <button class="sb-btn" data-cmd="zoomOut" title="Zoom Out" aria-label="Zoom out">${icons.minus}</button>
    <input type="range" id="zoom-range" min="25" max="300" step="5" aria-label="Zoom">
    <button class="sb-btn" data-cmd="zoomIn" title="Zoom In" aria-label="Zoom in">${icons.plus}</button>
  </div>
  <button class="sb-zoomval" id="zoom-val" data-menu="zoom" title="Zoom level"></button>
</footer>
<div class="backstage" id="backstage" hidden>
  <nav class="bs-side" aria-label="File">
    <button class="bs-back" data-bs="back" title="Back to the document" aria-label="Back">${icons.back}</button>
    <button class="bs-link" data-bs="open">${icons.folder}<span>Open</span></button>
    <button class="bs-link" data-bs="info">${icons.info}<span>Info</span></button>
    <span class="bs-side-spacer"></span>
    <button class="bs-link" data-bs="close"><span>Close</span></button>
  </nav>
  <div class="bs-main" id="bs-main"></div>
</div>
<div class="drop-overlay" id="drop" hidden><div>${icons.bigOpen}<span>Drop an .epub file to open it</span></div></div>
<input type="file" id="file-input" accept=".epub,application/epub+zip" hidden>`;

const $ = (sel) => app.querySelector(sel);
const canvas = $('#canvas');
const docEl = $('#doc');
const backstage = $('#backstage');
const fileInput = $('#file-input');
const measure = h('<div class="measure" aria-hidden="true"></div>');
document.body.append(measure);

// ---------------------------------------------------------------------------
// Settings

function spacingLabel(v) {
  return v === 1.15 ? '1.15' : v.toFixed(1);
}

function dims() {
  const s = getSettings();
  const size = PAGE_SIZES[s.pageSize];
  const m = MARGINS[s.margins];
  return { w: size.w, h: size.h, mv: m.v, mh: m.h, contentH: size.h - 2 * m.v };
}

function applySettings() {
  const s = getSettings();
  const d = dims();
  const root = document.documentElement;
  Object.assign(root.dataset, {
    theme: s.theme, align: s.align, para: s.para, hf: s.pageNumbers ? 'on' : 'off',
  });
  const st = root.style;
  st.setProperty('--page-w', `${d.w}px`);
  st.setProperty('--page-h', `${d.h}px`);
  st.setProperty('--mv', `${d.mv}px`);
  st.setProperty('--mh', `${d.mh}px`);
  st.setProperty('--content-h', `${d.contentH}px`);
  st.setProperty('--doc-font', FONTS[s.font].stack);
  st.setProperty('--doc-size', `${(s.fontPt * 4) / 3}px`);
  st.setProperty('--doc-lh', (s.spacing * 1.2).toFixed(3));
  app.classList.toggle('ribbon-collapsed', !s.ribbon);
  syncNav();
}

function update(patch) {
  const before = getSettings();
  const changed = Object.keys(patch).filter((k) => before[k] !== patch[k]);
  if (!changed.length) return;
  const relayout = changed.some((k) => LAYOUT_KEYS.includes(k));
  if (relayout && state.book && state.pendingAnchor === undefined) state.pendingAnchor = computeAnchor();
  const keep = !relayout && state.book ? capturePagePos() : null;
  setSettings(patch);
  applySettings();
  syncControls();
  if (relayout && state.book) scheduleRelayout();
  else if (changed.some((k) => ['zoom', 'sidebar', 'ribbon'].includes(k))) applyZoom(keep);
}

let relayoutTimer;
function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    const anchor = state.pendingAnchor;
    state.pendingAnchor = undefined;
    showChapter(state.ch, { anchor, keepHits: true });
  }, 120);
}

function syncControls() {
  const s = getSettings();
  $('#font-family').value = s.font;
  const sizeSel = $('#font-size');
  if (![...sizeSel.options].some((o) => Number(o.value) === s.fontPt)) {
    sizeSel.append(h(`<option value="${s.fontPt}">${s.fontPt}</option>`));
  }
  sizeSel.value = String(s.fontPt);
  $('#spacing').value = String(s.spacing);
  $('#para').value = s.para;
  for (const b of app.querySelectorAll('[data-cmd="align"]')) b.setAttribute('aria-pressed', String(b.dataset.value === s.align));
  $('[data-cmd="para"]').setAttribute('aria-pressed', String(s.para === 'indented'));
  $('#chk-nav').checked = navVisible();
  $('#chk-hf').checked = s.pageNumbers;
  $('#chk-ribbon').checked = s.ribbon;
  const rt = $('.ribbon-toggle');
  rt.innerHTML = s.ribbon ? icons.ribbonUp : icons.ribbonDown;
  rt.title = s.ribbon ? 'Collapse the Ribbon' : 'Pin the Ribbon';
  rt.setAttribute('aria-label', rt.title);
  syncZoomControls();
}

function syncZoomControls() {
  const pct = Math.round(state.zoom * 100);
  $('#zoom-range').value = String(pct);
  $('#zoom-val').textContent = `${pct}%`;
}

// ---------------------------------------------------------------------------
// Zoom

function effectiveZoom() {
  const s = getSettings();
  const d = dims();
  const pad = narrowMQ.matches ? 16 : 48;
  const fitW = Math.max(80, canvas.clientWidth - pad) / d.w;
  const fitP = Math.min(fitW, Math.max(80, canvas.clientHeight - pad) / d.h);
  let z;
  if (s.zoom === 'fit') z = fitW;
  else if (s.zoom === 'page') z = fitP;
  else if (s.zoom === 'auto') z = Math.min(1, fitW);
  else z = Number(s.zoom) / 100 || 1;
  return Math.max(0.1, Math.min(5, z));
}

function applyZoom(keep = capturePagePos()) {
  const z = effectiveZoom();
  state.zoom = z;
  docEl.style.setProperty('--zoom', String(z));
  restorePagePos(keep);
  syncZoomControls();
}

function zoomBy(delta) {
  const cur = Math.round(state.zoom * 100);
  const next = Math.max(25, Math.min(300, (delta > 0 ? Math.floor(cur / 10) * 10 : Math.ceil(cur / 10) * 10) + delta));
  update({ zoom: next });
}

// ---------------------------------------------------------------------------
// Positions within the document

const canvasTop = () => canvas.getBoundingClientRect().top;

/** Index of the last page whose top is at or above viewport y. */
function pageIndexAt(y) {
  const pages = state.pages;
  let lo = 0;
  let hi = pages.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].getBoundingClientRect().top <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function capturePagePos() {
  if (!state.pages.length) return null;
  const top = canvasTop();
  const i = pageIndexAt(top);
  const r = state.pages[i].getBoundingClientRect();
  return { i, frac: (top - r.top) / r.height };
}

function restorePagePos(pos) {
  if (!pos || !state.pages[pos.i]) return;
  const r = state.pages[pos.i].getBoundingClientRect();
  canvas.scrollTop += r.top + pos.frac * r.height - canvasTop();
}

/** data-p id of the first paragraph visible at the top of the window. */
function computeAnchor() {
  if (!state.pages.length) return null;
  const top = canvasTop() + 4;
  const i = pageIndexAt(top);
  for (let j = i; j < Math.min(state.pages.length, i + 2); j++) {
    for (const el of state.pages[j].querySelectorAll('.page-body [data-p]')) {
      if (el.querySelector('[data-p]')) continue;
      if (el.getBoundingClientRect().bottom > top) return el.dataset.p;
    }
  }
  return null;
}

function scrollToPage(i) {
  const page = state.pages[i];
  if (!page) return;
  canvas.scrollTop += page.getBoundingClientRect().top - canvasTop() - 12;
}

function scrollToElement(el) {
  const page = el.closest('.page');
  const body = page?.querySelector('.page-body');
  if (body && el.getBoundingClientRect().top - body.getBoundingClientRect().top < 6) {
    scrollToPage(state.pages.indexOf(page));
  } else {
    canvas.scrollTop += el.getBoundingClientRect().top - canvasTop() - 48;
  }
}

function stepPage(d) {
  if (!state.pages.length) return;
  const top = canvasTop();
  const i = pageIndexAt(top + 16);
  const midPage = state.pages[i].getBoundingClientRect().top < top - 16;
  const target = d > 0 ? i + 1 : (midPage ? i : i - 1);
  if (target >= state.pages.length) goChapter(1);
  else if (target < 0) goChapter(-1, { atEnd: true });
  else scrollToPage(target);
}

const atBottom = () => canvas.scrollTop + canvas.clientHeight >= canvas.scrollHeight - 4;
const atTop = () => canvas.scrollTop <= 2;

// ---------------------------------------------------------------------------
// Rendering a section as pages

function getChapter(ch) {
  let p = state.cache.get(ch);
  if (p) {
    state.cache.delete(ch);
  } else {
    p = state.book.loadChapter(ch);
    p.catch(() => state.cache.delete(ch));
  }
  state.cache.set(ch, p);
  while (state.cache.size > 5) state.cache.delete(state.cache.keys().next().value);
  return p;
}

function decodeImages(nodes) {
  const imgs = [];
  for (const n of nodes) {
    if (n.localName === 'img') imgs.push(n);
    imgs.push(...n.querySelectorAll('img'));
  }
  return Promise.all(imgs.map((img) => img.decode().catch(() => {})));
}

function setBusy(on) {
  $('#busy').hidden = !on;
}

async function showChapter(ch, opts = {}) {
  const book = state.book;
  if (!book) return;
  ch = Math.max(0, Math.min(book.spine.length - 1, ch));
  const token = ++state.token;
  const slow = setTimeout(() => { if (token === state.token) setBusy(true); }, 120);
  try {
    const data = await getChapter(ch);
    if (token !== state.token || book !== state.book) return;
    const nodes = data.nodes.map((n) => n.cloneNode(true));
    await decodeImages(nodes);
    if (token !== state.token || book !== state.book) return;

    state.ch = ch;
    state.words = data.words;
    layoutPages(nodes);
    docEl.style.setProperty('--zoom', String(state.zoom));
    renderDocNav();
    findHits();
    position(opts);
    updateView(true);
    if (!document.activeElement?.closest('input, select, .navpane')) canvas.focus({ preventScroll: true });

    // Warm up the next section so "Next" is instant.
    setTimeout(() => {
      if (state.book === book && token === state.token && ch + 1 < book.spine.length) getChapter(ch + 1).catch(() => {});
    }, 600);
  } catch (err) {
    if (token === state.token) {
      console.error(err);
      toast(`Could not display this section: ${err.message || err}`);
    }
  } finally {
    clearTimeout(slow);
    if (token === state.token) setBusy(false);
  }
}

function layoutPages(nodes) {
  const pages = [];
  const frag = document.createDocumentFragment();
  measure.replaceChildren();
  paginateChapter(nodes, state.ch, measure, (page) => {
    pages.push(page);
    frag.append(page);
  }, dims().contentH);
  measure.replaceChildren();
  if (!pages.length) {
    const blank = createPage();
    blank.dataset.chstart = state.ch;
    pages.push(blank);
    frag.append(blank);
  }

  const book = state.record?.title || '';
  const section = sectionTitle(state.ch);
  pages.forEach((page, i) => {
    page.prepend(h(`<div class="page-head"><span>${esc(book)}</span><span>${esc(section)}</span></div>`));
    page.append(h(`<div class="page-foot">${i + 1}</div>`));
  });
  docEl.replaceChildren(frag);
  state.pages = pages;
}

function position(opts) {
  let el = null;
  if (opts.frag) el = document.getElementById(opts.frag);
  if (!el && opts.anchor) el = docEl.querySelector(`[data-p="${CSS.escape(opts.anchor)}"]`);
  if (el && docEl.contains(el)) {
    canvas.scrollTop = 0;
    scrollToElement(el);
  } else if (opts.hit != null && state.search.ranges.length) {
    canvas.scrollTop = 0;
    showHit(opts.hit);
  } else if (opts.atEnd) {
    canvas.scrollTop = 0;
    scrollToPage(state.pages.length - 1);
  } else {
    canvas.scrollTop = 0;
  }
}

function renderDocNav() {
  const n = state.book.spine.length;
  const ch = state.ch;
  const prev = ch > 0
    ? `<button class="dn-btn" data-cmd="prev">${icons.chapterPrev}<span><small>Previous section</small>${esc(sectionTitle(ch - 1))}</span></button>`
    : '<span></span>';
  const next = ch < n - 1
    ? `<button class="dn-btn dn-next" data-cmd="next"><span><small>Next section</small>${esc(sectionTitle(ch + 1))}</span>${icons.chapterNext}</button>`
    : '<span class="dn-end">End of book</span>';
  $('#doc-nav').innerHTML = prev + next;
}

function goChapter(d, opts = {}) {
  if (!state.book) return;
  const target = state.ch + d;
  if (target < 0 || target >= state.book.spine.length) {
    toast(d > 0 ? 'This is the last section.' : 'This is the first section.');
    return;
  }
  showChapter(target, opts);
}

/** Label for a spine item: its TOC entry, or the nearest one before it. */
function sectionTitle(ch) {
  const own = state.toc.find((e) => e.ch === ch);
  if (own) return own.label;
  return `Section ${ch + 1}`;
}

// ---------------------------------------------------------------------------
// Status bar, contents highlight and position saving

let viewTicking = false;
function onScroll() {
  if (viewTicking) return;
  viewTicking = true;
  requestAnimationFrame(() => {
    viewTicking = false;
    updateView(false);
  });
}

function updateView(rendered) {
  if (!state.book) return;
  const n = state.pages.length;
  const i = n ? pageIndexAt(canvasTop() + canvas.clientHeight * 0.35) : 0;
  $('#sb-page').textContent = `Page ${Math.min(i + 1, n)} of ${n}`;
  if (rendered) {
    $('#sb-section').textContent = `Section ${state.ch + 1} of ${state.book.spine.length}`;
    $('#sb-words').textContent = `${state.words.toLocaleString()} words`;
  }
  updateActiveToc(rendered);
  savePosSoon();
}

let saveTimer;
function savePosSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePos, 700);
}

function savePos() {
  clearTimeout(saveTimer);
  const rec = state.record;
  if (!rec || !state.pages.length || state.pendingAnchor !== undefined) return;
  const pos = { ch: state.ch, p: computeAnchor() };
  if (rec.pos?.ch === pos.ch && rec.pos?.p === pos.p) return;
  rec.pos = pos;
  rec.opened = Date.now();
  if (!rec.ephemeral) db.updateBook(rec.id, { pos, opened: rec.opened }).catch(() => {});
}

addEventListener('pagehide', savePos);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); });

// ---------------------------------------------------------------------------
// Navigation pane

function navVisible() {
  return narrowMQ.matches ? state.navMobile : getSettings().sidebar;
}

function toggleNav(force) {
  const show = force ?? !navVisible();
  if (narrowMQ.matches) {
    state.navMobile = show;
    syncNav();
    syncControls();
  } else {
    update({ sidebar: show });
  }
}

function syncNav() {
  const show = navVisible();
  app.classList.toggle('nav-open', show);
  $('#navpane').setAttribute('aria-hidden', String(!show));
  $('#navpane').inert = !show;
}

function renderToc() {
  const toc = state.toc;
  const tocEl = $('#toc');
  if (!toc.length) {
    tocEl.innerHTML = '<p class="np-empty">This book has no table of contents.</p>';
    return;
  }
  tocEl.innerHTML = toc.map((e, i) => {
    const parent = toc[i + 1] && toc[i + 1].depth > e.depth;
    return `<div class="toc-row" data-i="${i}" role="treeitem" aria-level="${e.depth + 1}"${parent ? ' aria-expanded="true"' : ''} style="--depth:${Math.min(e.depth, 6)}">` +
      (parent ? `<button class="toc-caret" data-caret="${i}" tabindex="-1" aria-label="Collapse">${icons.caret}</button>` : '<span class="toc-caret-gap"></span>') +
      `<button class="toc-link" data-goto="${i}" title="${esc(e.label)}">${esc(e.label)}</button></div>`;
  }).join('');
  applyCollapsed();
}

function applyCollapsed() {
  let hideBelow = Infinity;
  for (const row of $('#toc').querySelectorAll('.toc-row')) {
    const i = Number(row.dataset.i);
    const depth = state.toc[i].depth;
    if (depth <= hideBelow) hideBelow = Infinity;
    row.hidden = depth > hideBelow;
    if (row.hasAttribute('aria-expanded')) {
      const collapsed = state.collapsed.has(i);
      row.setAttribute('aria-expanded', String(!collapsed));
      row.querySelector('.toc-caret')?.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
      if (collapsed && !row.hidden) hideBelow = depth;
    }
  }
}

function activeTocIndex() {
  const toc = state.toc;
  const probe = canvasTop() + canvas.clientHeight * 0.3;
  let best = -1;
  let first = -1;
  let before = -1;
  for (let i = 0; i < toc.length; i++) {
    const e = toc[i];
    if (e.ch < state.ch) before = i;
    if (e.ch !== state.ch) continue;
    if (first === -1) first = i;
    const el = e.frag ? document.getElementById(`x${e.ch}_${e.frag}`) : null;
    const top = el && docEl.contains(el) ? el.getBoundingClientRect().top : -Infinity;
    if (top <= probe) best = i;
  }
  if (best !== -1) return best;
  return first !== -1 ? first : before;
}

function updateActiveToc(reveal) {
  const i = activeTocIndex();
  if (i === state.activeToc && !reveal) return;
  state.activeToc = i;
  const tocEl = $('#toc');
  tocEl.querySelector('.toc-row.active')?.classList.remove('active');
  const row = tocEl.querySelector(`.toc-row[data-i="${i}"]`);
  if (!row) return;
  // Expand collapsed ancestors so the current heading is visible.
  let depth = state.toc[i].depth;
  for (let j = i - 1; j >= 0 && depth > 0; j--) {
    if (state.toc[j].depth < depth) {
      state.collapsed.delete(j);
      depth = state.toc[j].depth;
    }
  }
  applyCollapsed();
  row.classList.add('active');
  if (navVisible() && $('#results').hidden) row.scrollIntoView({ block: 'nearest' });
}

function gotoToc(i) {
  const e = state.toc[i];
  if (!e) return;
  const frag = e.frag ? `x${e.ch}_${e.frag}` : null;
  if (e.ch === state.ch && state.pages.length) {
    const el = frag && document.getElementById(frag);
    if (el && docEl.contains(el)) scrollToElement(el);
    else canvas.scrollTop = 0;
  } else {
    showChapter(e.ch, { frag });
  }
  if (narrowMQ.matches) toggleNav(false);
}

// ---------------------------------------------------------------------------
// Search (whole book, plain text; hits highlighted in the visible section)

let searchTimer;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch($('#search').value), 250);
}

async function runSearch(raw) {
  const q = raw.trim();
  const s = state.search;
  const token = ++s.token;
  s.query = q;
  s.results = [];
  const book = state.book;
  $('#results').hidden = !q;
  $('#toc').hidden = !!q;
  $('#np-label').textContent = q ? 'Results' : 'Headings';
  $('#np-count').textContent = '';
  findHits();
  if (!q || !book) return;

  const ql = q.toLowerCase();
  const resultsEl = $('#results');
  resultsEl.innerHTML = '<p class="np-empty">Searching…</p>';
  for (let ch = 0; ch < book.spine.length && s.results.length < 500; ch++) {
    let t = s.texts.get(ch);
    if (t == null) {
      try { t = await book.chapterText(ch); } catch { t = ''; }
      if (book !== state.book) return;
      s.texts.set(ch, t);
    }
    if (token !== s.token) return;
    const lower = t.toLowerCase();
    let k = 0;
    for (let idx = lower.indexOf(ql); idx !== -1 && s.results.length < 500; idx = lower.indexOf(ql, idx + ql.length)) {
      s.results.push({ ch, k: k++, before: t.slice(Math.max(0, idx - 40), idx), match: t.slice(idx, idx + q.length), after: t.slice(idx + q.length, idx + q.length + 60), cut: idx > 40 });
    }
  }
  renderResults();
}

function renderResults() {
  const s = state.search;
  const n = s.results.length;
  $('#np-count').textContent = n ? `${n >= 500 ? '500+' : n} result${n === 1 ? '' : 's'}` : '';
  if (!n) {
    $('#results').innerHTML = `<p class="np-empty">No results for “${esc(s.query)}”.</p>`;
    return;
  }
  let last = -1;
  $('#results').innerHTML = s.results.map((r, i) => {
    const head = r.ch !== last ? `<div class="res-head">${esc(sectionTitle(r.ch))}</div>` : '';
    last = r.ch;
    return `${head}<button class="res" data-r="${i}">${r.cut ? '…' : ''}${esc(r.before)}<mark>${esc(r.match)}</mark>${esc(r.after)}…</button>`;
  }).join('');
}

function findHits() {
  const s = state.search;
  s.ranges = [];
  const hl = typeof CSS !== 'undefined' && CSS.highlights;
  hl?.delete('search');
  hl?.delete('search-current');
  if (!s.query || !state.pages.length) return;
  const ql = s.query.toLowerCase();
  const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.page-body') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const lower = n.data.toLowerCase();
    for (let idx = lower.indexOf(ql); idx !== -1; idx = lower.indexOf(ql, idx + ql.length)) {
      const r = document.createRange();
      r.setStart(n, idx);
      r.setEnd(n, Math.min(n.length, idx + ql.length));
      s.ranges.push(r);
    }
  }
  if (hl && s.ranges.length) hl.set('search', new Highlight(...s.ranges));
}

function showHit(k) {
  const ranges = state.search.ranges;
  const r = ranges[k] ?? ranges[0];
  if (!r) return;
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.set('search-current', new Highlight(r));
  canvas.scrollTop += r.getBoundingClientRect().top - canvasTop() - canvas.clientHeight / 3;
}

function gotoResult(i) {
  const r = state.search.results[i];
  if (!r) return;
  for (const b of $('#results').querySelectorAll('.res.active')) b.classList.remove('active');
  $(`#results .res[data-r="${i}"]`)?.classList.add('active');
  if (r.ch === state.ch && state.pages.length) showHit(r.k);
  else showChapter(r.ch, { hit: r.k });
  if (narrowMQ.matches) toggleNav(false);
}

function openSearch() {
  toggleNav(true);
  const input = $('#search');
  input.focus();
  input.select();
}

// ---------------------------------------------------------------------------
// Opening, closing and the File backstage

async function hashId(buffer) {
  try {
    const d = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

async function importFile(file) {
  if (!file) return;
  setBusy(true);
  try {
    const buffer = await file.arrayBuffer();
    let meta;
    try {
      meta = await readMetadata(buffer);
    } catch (err) {
      setBusy(false);
      await dialog({ title: 'Could not open file', body: `<p>“${esc(file.name)}” could not be opened as an EPUB book.</p><p class="muted">${esc(err.message || err)}</p>` });
      return;
    }
    const id = await hashId(buffer);
    let existing = null;
    try { existing = await db.getBook(id); } catch { /* storage unavailable */ }
    const record = {
      id,
      title: meta.title || file.name.replace(/\.epub$/i, ''),
      author: meta.author,
      language: meta.language,
      chapters: meta.chapters,
      cover: meta.cover,
      size: buffer.byteLength,
      fileName: file.name,
      added: existing?.added ?? Date.now(),
      opened: Date.now(),
      pos: existing?.pos ?? null,
    };
    try {
      await db.addBook(record, buffer);
      db.requestPersistence();
    } catch {
      record.ephemeral = true;
      toast('This browser is not allowing storage; the book will not be remembered.');
    }
    await openBook(record, buffer);
  } finally {
    setBusy(false);
  }
}

async function openBook(recordOrId, buffer) {
  setBusy(true);
  try {
    const record = typeof recordOrId === 'string' ? await db.getBook(recordOrId) : recordOrId;
    if (!record) throw new Error('This book is no longer stored on this device.');
    buffer ??= await db.getFile(record.id);
    if (!buffer) throw new Error('The file for this book is missing.');
    const book = await openEpub(buffer);

    closeBook({ keepBackstage: true });
    state.book = book;
    state.record = record;
    state.toc = book.toc;
    state.collapsed = new Set();
    state.activeToc = -1;
    state.search.texts = new Map();
    if (!record.ephemeral) {
      try { localStorage.setItem(LAST_KEY, record.id); } catch { /* ignore */ }
      db.updateBook(record.id, { opened: Date.now() }).catch(() => {});
    }

    const lang = book.meta.language || record.language || '';
    docEl.lang = lang;
    measure.lang = lang;
    $('#sb-lang').textContent = languageName(lang);
    setTitle();
    renderToc();
    hideBackstage();
    if ($('#search').value.trim()) runSearch($('#search').value);

    const pos = record.pos;
    await showChapter(pos?.ch ?? 0, { anchor: pos?.p });
  } catch (err) {
    console.error(err);
    setBusy(false);
    await dialog({ title: 'Could not open book', body: `<p>${esc(err.message || err)}</p>` });
    if (!state.book) showBackstage('open');
  } finally {
    setBusy(false);
  }
}

function closeBook({ keepBackstage = false } = {}) {
  savePos();
  state.token++;
  state.book?.dispose();
  state.book = null;
  state.record = null;
  state.toc = [];
  state.pages = [];
  state.cache = new Map();
  state.search.ranges = [];
  docEl.replaceChildren();
  $('#doc-nav').replaceChildren();
  $('#toc').replaceChildren();
  for (const id of ['#sb-section', '#sb-page', '#sb-words', '#sb-lang']) $(id).textContent = '';
  setTitle();
  if (!keepBackstage) {
    try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
    showBackstage('open');
  }
}

function setTitle() {
  const rec = state.record;
  $('#doc-title').innerHTML = rec
    ? `<span class="tb-doc">${esc(rec.title)}</span>${rec.author ? `<span class="tb-author"> — ${esc(rec.author)}</span>` : ''}`
    : '<span class="tb-doc">No document open</span>';
  document.title = rec ? `${rec.title} – Reader` : 'Reader';
  app.classList.toggle('no-doc', !rec);
}

function languageName(code) {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function openPicker() {
  fileInput.value = '';
  fileInput.click();
}

let coverUrls = [];
function releaseCovers() {
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls = [];
}

function coverImg(rec, cls) {
  if (!(rec.cover instanceof Blob)) return `<span class="${cls} no-cover">${icons.doc}</span>`;
  const url = URL.createObjectURL(rec.cover);
  coverUrls.push(url);
  return `<img class="${cls}" src="${url}" alt="">`;
}

async function showBackstage(view = 'open') {
  backstage.hidden = false;
  app.classList.add('bs-open');
  $('.bs-back').hidden = !state.book;
  $('[data-bs="close"]').hidden = !state.book;
  for (const b of backstage.querySelectorAll('.bs-link')) b.classList.toggle('active', b.dataset.bs === view);
  const main = $('#bs-main');
  releaseCovers();

  if (view === 'info') {
    const rec = state.record;
    if (!rec) {
      main.innerHTML = '<h1>Info</h1><p class="muted">No document is open.</p>';
      return;
    }
    const fmt = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
    main.innerHTML = `
      <h1>Info</h1>
      <div class="info">
        ${coverImg(rec, 'info-cover')}
        <div class="info-text">
          <h2>${esc(rec.title)}</h2>
          <table class="props">
            <tr><th>Author</th><td>${esc(rec.author || '—')}</td></tr>
            <tr><th>Language</th><td>${esc(languageName(rec.language) || '—')}</td></tr>
            <tr><th>Sections</th><td>${state.book.spine.length}</td></tr>
            <tr><th>Contents entries</th><td>${state.toc.length}</td></tr>
            <tr><th>Current section</th><td>${state.ch + 1} — ${esc(sectionTitle(state.ch))} (${state.pages.length} pages, ${state.words.toLocaleString()} words)</td></tr>
            <tr><th>File</th><td>${esc(rec.fileName || '—')}${rec.size ? ` · ${(rec.size / 1048576).toFixed(1)} MB` : ''}</td></tr>
            <tr><th>Added</th><td>${fmt(rec.added)}</td></tr>
          </table>
          <p class="muted">${rec.ephemeral ? 'This book is open for this visit only.' : 'This book is stored in this browser on this device. Nothing is uploaded.'}</p>
        </div>
      </div>`;
    return;
  }

  let books = [];
  try { books = await db.listBooks(); } catch { /* storage unavailable */ }
  books.sort((a, b) => (b.opened || 0) - (a.opened || 0));
  main.innerHTML = `
    <h1>${state.book ? 'Open' : 'Welcome'}</h1>
    <button class="bs-browse" data-bs="browse">
      ${icons.bigOpen}
      <span><strong>Browse…</strong><small>Choose an .epub file from this device, or drop one anywhere in the window.</small></span>
    </button>
    <h2 class="bs-h2">Recent</h2>
    ${books.length ? `<ul class="recent">${books.map((b) => {
      const pct = b.pos && b.chapters ? Math.round((b.pos.ch / b.chapters) * 100) : 0;
      return `<li class="recent-item${state.record?.id === b.id ? ' current' : ''}">
        <button class="ri-main" data-open="${esc(b.id)}">
          ${coverImg(b, 'ri-cover')}
          <span class="ri-text"><span class="ri-title">${esc(b.title)}</span><span class="ri-sub">${esc(b.author || 'Unknown author')}</span></span>
          <span class="ri-meta"><span>${b.pos ? `Section ${b.pos.ch + 1} of ${b.chapters} · ${pct}%` : 'Not started'}</span><span>${esc(relativeTime(b.opened))}</span></span>
        </button>
        <button class="icon-btn ri-more" data-more="${esc(b.id)}" aria-label="More options for ${esc(b.title)}" title="More options">${icons.more}</button>
      </li>`;
    }).join('')}</ul>` : '<p class="muted bs-empty">Books you open will appear here. They are kept in this browser only.</p>'}`;
}

function hideBackstage() {
  if (!state.book) return;
  backstage.hidden = true;
  app.classList.remove('bs-open');
  releaseCovers();
  canvas.focus({ preventScroll: true });
}

async function removeBook(id) {
  let rec = null;
  try { rec = await db.getBook(id); } catch { /* ignore */ }
  const choice = await dialog({
    title: 'Remove book',
    body: `<p>Remove “${esc(rec?.title || 'this book')}” from this device? You can open the file again at any time.</p>`,
    buttons: [{ id: 'remove', label: 'Remove', primary: true }, { id: 'cancel', label: 'Cancel' }],
  });
  if (choice !== 'remove') return;
  await db.deleteBook(id);
  if (state.record?.id === id) closeBook();
  else showBackstage('open');
}

// ---------------------------------------------------------------------------
// Menus and commands

function menuItems(name) {
  const s = getSettings();
  const pick = (cond) => (cond ? 'check' : null);
  switch (name) {
    case 'font':
      return Object.entries(FONTS).map(([k, f]) => ({ label: f.label, icon: pick(s.font === k), action: () => update({ font: k }) }));
    case 'spacing':
      return [
        ...SPACINGS.map((v) => ({ label: spacingLabel(v), icon: pick(s.spacing === v), action: () => update({ spacing: v }) })),
        '-',
        { label: 'Space after paragraphs', icon: pick(s.para === 'spaced'), action: () => update({ para: 'spaced' }) },
        { label: 'Indent first lines', icon: pick(s.para === 'indented'), action: () => update({ para: 'indented' }) },
      ];
    case 'margins':
      return Object.entries(MARGINS).map(([k, m]) => ({ label: `${m.label}  ·  ${m.desc}`, icon: pick(s.margins === k), action: () => update({ margins: k }) }));
    case 'size':
      return Object.entries(PAGE_SIZES).map(([k, p]) => ({ label: `${p.label}  ·  ${p.desc}`, icon: pick(s.pageSize === k), action: () => update({ pageSize: k }) }));
    case 'color':
      return Object.entries(THEMES).map(([k, t]) => ({ label: t.label, icon: pick(s.theme === k), action: () => update({ theme: k }) }));
    case 'zoom':
      return [
        ...ZOOM_PRESETS.map((v) => ({ label: `${v}%`, icon: pick(s.zoom === v), action: () => update({ zoom: v }) })),
        '-',
        { label: 'Page width', icon: pick(s.zoom === 'fit'), action: () => update({ zoom: 'fit' }) },
        { label: 'One page', icon: pick(s.zoom === 'page'), action: () => update({ zoom: 'page' }) },
        { label: 'Fit to window', icon: pick(s.zoom === 'auto'), action: () => update({ zoom: 'auto' }) },
      ];
    default:
      return [];
  }
}

function stepFont(d) {
  const cur = getSettings().fontPt;
  const next = d > 0 ? SIZES.find((v) => v > cur) : [...SIZES].reverse().find((v) => v < cur);
  if (next) update({ fontPt: next });
}

const commands = {
  grow: () => stepFont(1),
  shrink: () => stepFont(-1),
  align: (el) => update({ align: el.dataset.value }),
  para: () => update({ para: getSettings().para === 'indented' ? 'spaced' : 'indented' }),
  prev: () => goChapter(-1),
  next: () => goChapter(1),
  nav: () => toggleNav(),
  zoomIn: () => zoomBy(10),
  zoomOut: () => zoomBy(-10),
  zoom100: () => update({ zoom: 100 }),
  zoomWidth: () => update({ zoom: 'fit' }),
  zoomPage: () => update({ zoom: 'page' }),
  ribbon: () => update({ ribbon: !getSettings().ribbon }),
};

function selectTab(name) {
  for (const t of app.querySelectorAll('.tab[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of app.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
  app.classList.add('ribbon-peek');
}

app.addEventListener('click', (e) => {
  const t = e.target;
  const tab = t.closest('.tab');
  if (tab) {
    if (tab.dataset.action === 'file') showBackstage('open');
    else selectTab(tab.dataset.tab);
    return;
  }
  const cmd = t.closest('[data-cmd]');
  if (cmd) {
    commands[cmd.dataset.cmd]?.(cmd);
    return;
  }
  const menu = t.closest('[data-menu]');
  if (menu) {
    popupMenu(menu, menuItems(menu.dataset.menu), { align: menu.closest('.statusbar') ? 'right' : 'left' });
    return;
  }
  const caret = t.closest('[data-caret]');
  if (caret) {
    const i = Number(caret.dataset.caret);
    if (state.collapsed.has(i)) state.collapsed.delete(i); else state.collapsed.add(i);
    applyCollapsed();
    return;
  }
  const go = t.closest('[data-goto]');
  if (go) { gotoToc(Number(go.dataset.goto)); return; }
  const res = t.closest('[data-r]');
  if (res) { gotoResult(Number(res.dataset.r)); return; }

  const bs = t.closest('[data-bs]');
  if (bs) {
    const v = bs.dataset.bs;
    if (v === 'back') hideBackstage();
    else if (v === 'browse') openPicker();
    else if (v === 'close') closeBook();
    else showBackstage(v);
    return;
  }
  const open = t.closest('[data-open]');
  if (open) {
    if (open.dataset.open === state.record?.id) hideBackstage();
    else openBook(open.dataset.open);
    return;
  }
  const more = t.closest('[data-more]');
  if (more) {
    const id = more.dataset.more;
    popupMenu(more, [
      { label: 'Open', icon: 'open', action: () => (id === state.record?.id ? hideBackstage() : openBook(id)) },
      { label: 'Remove from this device', icon: 'trash', action: () => removeBook(id) },
    ], { align: 'right' });
    return;
  }

  const link = t.closest('.doc a[data-link]');
  if (link) {
    e.preventDefault();
    followLink(link.dataset.link);
    return;
  }
  if (t.closest('.doc a[href="#"]')) e.preventDefault();

  // Clicking into the document closes a "peeked" collapsed ribbon.
  if (t.closest('.canvas')) app.classList.remove('ribbon-peek');
});

function followLink(target) {
  if (target.startsWith('ch')) {
    showChapter(Number(target.slice(2)));
    return;
  }
  const m = /^x(\d+)_/.exec(target);
  if (!m) return;
  const ch = Number(m[1]);
  const el = document.getElementById(target);
  if (ch === state.ch && el && docEl.contains(el)) scrollToElement(el);
  else showChapter(ch, { frag: target });
}

$('#font-family').addEventListener('change', (e) => update({ font: e.target.value }));
$('#font-size').addEventListener('change', (e) => update({ fontPt: Number(e.target.value) }));
$('#spacing').addEventListener('change', (e) => update({ spacing: Number(e.target.value) }));
$('#para').addEventListener('change', (e) => update({ para: e.target.value }));
$('#chk-nav').addEventListener('change', (e) => toggleNav(e.target.checked));
$('#chk-hf').addEventListener('change', (e) => update({ pageNumbers: e.target.checked }));
$('#chk-ribbon').addEventListener('change', (e) => update({ ribbon: e.target.checked }));
$('#zoom-range').addEventListener('input', (e) => update({ zoom: Number(e.target.value) }));
$('#search').addEventListener('input', onSearchInput);
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    const s = state.search;
    if (s.query === e.target.value.trim() && s.results.length) {
      // Enter again steps through results.
      const cur = Number($('#results .res.active')?.dataset.r ?? -1);
      gotoResult((cur + (e.shiftKey ? -1 : 1) + s.results.length) % s.results.length);
    } else {
      runSearch(e.target.value);
    }
  } else if (e.key === 'Escape') {
    e.target.value = '';
    runSearch('');
  }
});
fileInput.addEventListener('change', () => importFile(fileInput.files[0]));
canvas.addEventListener('scroll', onScroll, { passive: true });

canvas.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !state.book) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 10 : -10);
}, { passive: false });

new ResizeObserver(() => {
  if (typeof getSettings().zoom !== 'number' || state.zoom !== effectiveZoom()) applyZoom();
}).observe(canvas);

narrowMQ.addEventListener('change', () => {
  state.navMobile = false;
  syncNav();
  syncControls();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  if (mod && key.toLowerCase() === 'o') {
    e.preventDefault();
    openPicker();
    return;
  }
  if (document.querySelector('.ui-backdrop')) return;
  if (!backstage.hidden) {
    if (key === 'Escape' && state.book) hideBackstage();
    return;
  }
  if (!state.book) return;
  if (mod && key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
  if (mod && key === ']') { e.preventDefault(); stepFont(1); return; }
  if (mod && key === '[') { e.preventDefault(); stepFont(-1); return; }
  if (mod || e.altKey) return;
  if (key === 'Escape' && narrowMQ.matches && state.navMobile) { toggleNav(false); return; }
  if (document.querySelector('.ui-menu')) return;
  if (e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
  const onButton = e.target.closest('button');

  const step = canvas.clientHeight - 48;
  switch (key) {
    case 'ArrowRight': stepPage(1); break;
    case 'ArrowLeft': stepPage(-1); break;
    case 'ArrowDown': canvas.scrollTop += 48; break;
    case 'ArrowUp': canvas.scrollTop -= 48; break;
    case ' ':
      if (onButton) return;
      if (e.shiftKey) { if (atTop()) goChapter(-1, { atEnd: true }); else canvas.scrollTop -= step; } else if (atBottom()) goChapter(1); else canvas.scrollTop += step;
      break;
    case 'PageDown': if (atBottom()) goChapter(1); else canvas.scrollTop += step; break;
    case 'PageUp': if (atTop()) goChapter(-1, { atEnd: true }); else canvas.scrollTop -= step; break;
    case 'Home': canvas.scrollTop = 0; break;
    case 'End': canvas.scrollTop = canvas.scrollHeight; break;
    default: return;
  }
  e.preventDefault();
});

// Drag and drop an .epub anywhere.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#drop').hidden = false;
});
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop').hidden = true;
});
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  const file = [...e.dataTransfer.files].find((f) => /\.epub$/i.test(f.name)) ?? e.dataTransfer.files[0];
  importFile(file);
});

// ---------------------------------------------------------------------------
// Start-up

if (!hasStoredSettings() && narrowMQ.matches) {
  setSettings({ pageSize: 'a5', margins: 'narrow', fontPt: 14, ribbon: false });
}
applySettings();
state.zoom = effectiveZoom();
syncControls();
setTitle();

(async () => {
  let last = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
  let rec = null;
  if (last) {
    try { rec = await db.getBook(last); } catch { /* storage unavailable */ }
  }
  if (rec) await openBook(rec);
  else showBackstage('open');
})();
