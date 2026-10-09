// Flows chapter content into fixed-size "Letter" pages, the way Word lays out
// a document. Blocks that straddle a page boundary are split: containers by
// their children, text blocks at the first line that does not fit.

import { BLOCK } from './epub.js';

const ATOMIC = new Set(['tr', 'hr', 'img', 'col', 'colgroup']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function createPage() {
  const page = document.createElement('div');
  page.className = 'page';
  const body = document.createElement('div');
  body.className = 'page-body';
  page.append(body);
  return page;
}

/**
 * Paginate one chapter's nodes inside `host` (an unscaled, off-screen
 * container with the same typography as the document) and hand each finished
 * page to `emit`. `contentH` is the height of a page's text area in px.
 * Every chapter starts on a new page.
 */
export function paginateChapter(nodes, ch, host, emit, contentH) {
  const queue = nodes.slice();
  let page = createPage();
  let body = page.firstChild;
  page.dataset.chstart = ch;
  host.append(page);

  const finish = () => {
    // Keep a heading together with the paragraph that follows it.
    const last = body.lastElementChild;
    if (queue.length && body.childElementCount > 1 && last && HEADINGS.has(last.localName)) {
      last.remove();
      queue.unshift(last);
    }
    page.dataset.ch = ch;
    emit(page);
    page = createPage();
    body = page.firstChild;
    host.append(page);
  };

  while (queue.length) {
    const node = queue.shift();
    body.append(node);
    const top0 = body.getBoundingClientRect().top;
    const r = node.getBoundingClientRect();
    if (r.bottom - top0 <= contentH) continue;

    let rest = null;
    if (r.top - top0 < contentH) rest = split(node, top0 + contentH);
    if (rest) {
      queue.unshift(rest);
    } else if (body.childElementCount > 1) {
      node.remove();
      queue.unshift(node);
    } else {
      // A single unsplittable block taller than a page: let the page grow
      // rather than lose content.
      page.classList.add('tall');
    }
    finish();
  }

  if (body.childElementCount) {
    page.dataset.ch = ch;
    emit(page);
  } else {
    page.remove();
  }
}

const isBlockEl = (n) => n.nodeType === 1 && BLOCK.has(n.localName);

function shellOf(el) {
  const shell = el.cloneNode(false);
  shell.removeAttribute('id');
  shell.classList.add('cont');
  return shell;
}

/**
 * Split `el` so that the part left in place ends above `limit` (a viewport y
 * coordinate). Returns the remainder as a new element, or null when nothing
 * of `el` fits.
 */
function split(el, limit) {
  if (ATOMIC.has(el.localName)) return null;
  const kids = [...el.children];
  if (kids.some(isBlockEl)) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const r = k.getBoundingClientRect();
      if (r.bottom <= limit) continue;
      let rest = null;
      let moveFrom = i;
      if (r.top < limit) {
        rest = split(k, limit);
        if (rest) moveFrom = i + 1;
      }
      if (moveFrom === 0 && !rest) return null;
      const shell = shellOf(el);
      if (rest) shell.append(rest);
      shell.append(...kids.slice(moveFrom));
      if (el.localName === 'ol') {
        const kept = [...el.children].filter((c) => c.localName === 'li').length;
        const start = parseInt(el.getAttribute('start'), 10) || 1;
        shell.setAttribute('start', start + kept - (rest ? 1 : 0));
      }
      return shell;
    }
    return null;
  }
  return splitInline(el, limit);
}

function splitInline(el, limit) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let found = null;

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if (n.localName === 'img' && n.getBoundingClientRect().bottom > limit) {
        range.setStartBefore(n);
        found = true;
        break;
      }
      continue;
    }
    if (!/\S/.test(n.data)) continue;
    range.selectNodeContents(n);
    const rects = range.getClientRects();
    if (!rects.length || rects[rects.length - 1].bottom <= limit) continue;

    // Binary search for the first character whose line ends below the limit.
    let lo = 0;
    let hi = n.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(n, mid);
      range.setEnd(n, mid + 1);
      const cr = range.getClientRects();
      const bottom = cr.length ? cr[cr.length - 1].bottom : 0;
      if (bottom > limit) hi = mid;
      else lo = mid + 1;
    }
    range.setStart(n, lo);
    found = true;
    break;
  }
  if (!found) return null;

  // Nothing would stay on this page?
  const before = document.createRange();
  before.setStart(el, 0);
  before.setEnd(range.startContainer, range.startOffset);
  if (!/\S/.test(before.toString()) && !before.cloneContents().querySelector?.('img')) return null;

  range.setEnd(el, el.childNodes.length);
  const shell = shellOf(el);
  shell.append(range.extractContents());
  return shell;
}
