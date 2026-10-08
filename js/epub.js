/* global JSZip */
// Minimal EPUB 2/3 reader. Chapters are parsed from the zip and rebuilt as
// clean, sanitised DOM in the host page: the book's own CSS is discarded and
// only semantic formatting (italic, bold, alignment, sub/superscript, ...) is
// carried over, so the text can be restyled as a plain Word document.

const XLINK = 'http://www.w3.org/1999/xlink';
const OPS = 'http://www.idpf.org/2007/ops';

const DROP = new Set(('script style link meta head title iframe object embed form input button select ' +
  'textarea option audio video source track canvas noscript template base param map area applet frame ' +
  'frameset math-annotation').split(' '));
const KEEP = new Set(('p h1 h2 h3 h4 h5 h6 br hr em i strong b u s strike del ins sub sup small blockquote q ' +
  'cite code pre kbd samp var abbr dfn mark ul ol li dl dt dd table thead tbody tfoot tr th td caption ' +
  'colgroup col figure figcaption img a span div ruby rt rp time wbr bdi bdo').split(' '));
const RENAME = {
  section: 'div', article: 'div', header: 'div', footer: 'div', aside: 'div', main: 'div', nav: 'div',
  center: 'div', hgroup: 'div', address: 'div', details: 'div', fieldset: 'div', body: 'div',
  summary: 'p', legend: 'p', big: 'span', font: 'span', label: 'span', nobr: 'span', blink: 'span',
  tt: 'code', acronym: 'abbr', listing: 'pre', xmp: 'pre', plaintext: 'pre',
};
export const BLOCK = new Set(('p div h1 h2 h3 h4 h5 h6 blockquote ul ol li dl dt dd table thead tbody tfoot ' +
  'tr th td caption colgroup col figure figcaption pre hr').split(' '));
const COPY_ATTRS = ['alt', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'dir', 'scope', 'span'];

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};

function parseXml(str, type = 'application/xml') {
  const doc = new DOMParser().parseFromString(str, type);
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

function parseXhtml(str) {
  return parseXml(str, 'application/xhtml+xml') ?? new DOMParser().parseFromString(str, 'text/html');
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Resolve `href` relative to the file at `base` (both zip paths). Fragment is dropped. */
export function resolvePath(base, href) {
  const pathPart = href.split('#')[0].split('?')[0];
  if (!pathPart) return base;
  const parts = pathPart.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of safeDecode(pathPart).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function fragmentOf(href) {
  const i = href.indexOf('#');
  return i === -1 ? '' : safeDecode(href.slice(i + 1));
}

function text(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Formatting carried over from the book's CSS (everything else is dropped).

function pickProps(style) {
  const out = {};
  const get = (p) => style.getPropertyValue(p).trim().toLowerCase();
  const fs = get('font-style');
  if (fs === 'italic' || fs === 'oblique') out.italic = true;
  else if (fs === 'normal') out.italic = false;
  const fw = get('font-weight');
  if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) out.bold = true;
  const ta = get('text-align');
  if (ta === 'center' || ta === 'right' || ta === 'end') out.align = ta === 'end' ? 'right' : ta;
  const td = get('text-decoration-line') || get('text-decoration');
  if (td.includes('underline')) out.underline = true;
  if (td.includes('line-through')) out.strike = true;
  const va = get('vertical-align');
  if (va === 'super' || va === 'sub') out.valign = va;
  const fv = get('font-variant-caps') || get('font-variant');
  if (fv.includes('small-caps')) out.smallCaps = true;
  const tt = get('text-transform');
  if (tt === 'uppercase' || tt === 'lowercase' || tt === 'capitalize') out.transform = tt;
  if (get('display') === 'none') out.hidden = true;
  return Object.keys(out).length ? out : null;
}

function styleString(p) {
  const s = [];
  if (p.italic === true) s.push('font-style:italic');
  if (p.italic === false) s.push('font-style:normal');
  if (p.bold) s.push('font-weight:bold');
  if (p.align) s.push(`text-align:${p.align}`);
  const deco = [p.underline && 'underline', p.strike && 'line-through'].filter(Boolean);
  if (deco.length) s.push(`text-decoration:${deco.join(' ')}`);
  if (p.valign) s.push(`vertical-align:${p.valign};font-size:.75em;line-height:0`);
  if (p.smallCaps) s.push('font-variant:small-caps');
  if (p.transform) s.push(`text-transform:${p.transform}`);
  return s.join(';');
}

let scratch;
function parseInlineStyle(css) {
  scratch ??= document.createElement('div');
  scratch.setAttribute('style', css);
  const props = pickProps(scratch.style);
  scratch.removeAttribute('style');
  return props;
}

function sheetFromText(css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replace(/@import[^;]*;/g, ''));
    return sheet;
  } catch {
    return null;
  }
}

function buildStyleMap(doc, sheets) {
  const map = new Map();
  for (const sheet of sheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const props = pickProps(rule.style);
      if (!props) continue;
      let els;
      try { els = doc.querySelectorAll(rule.selectorText); } catch { continue; }
      for (const el of els) map.set(el, Object.assign(map.get(el) || {}, props));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------

export async function openEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Map();
  const lower = new Map();
  zip.forEach((p, f) => {
    if (f.dir) return;
    files.set(p, f);
    lower.set(p.toLowerCase(), f);
  });
  const getFile = (p) => files.get(p) ?? lower.get(p.toLowerCase());
  const readText = async (p) => {
    const f = getFile(p);
    if (!f) throw new Error(`Missing file in EPUB: ${p}`);
    return f.async('string');
  };

  const container = parseXml(await readText('META-INF/container.xml'));
  const opfPath = container?.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('This file is not a valid EPUB (no package document).');
  const opf = parseXml(await readText(opfPath));
  if (!opf) throw new Error('This file is not a valid EPUB (unreadable package document).');

  const dc = (name) => text(opf.getElementsByTagNameNS('*', name)[0]);
  const meta = { title: dc('title'), author: dc('creator'), language: dc('language') };

  const manifest = new Map();
  for (const it of opf.getElementsByTagNameNS('*', 'item')) {
    manifest.set(it.getAttribute('id'), {
      path: resolvePath(opfPath, it.getAttribute('href') || ''),
      type: (it.getAttribute('media-type') || '').toLowerCase(),
      props: (it.getAttribute('properties') || '').split(/\s+/),
    });
  }

  const spine = [];
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    if (item && (item.type.includes('html') || /\.x?html?$/i.test(item.path))) spine.push(item.path);
  }
  if (!spine.length) throw new Error('This EPUB has no readable chapters.');
  const spineIndex = new Map(spine.map((p, i) => [p, i]));
  const spineIndexLower = new Map(spine.map((p, i) => [p.toLowerCase(), i]));
  const chapterOf = (p) => spineIndex.get(p) ?? spineIndexLower.get(p.toLowerCase());

  // Table of contents: EPUB 3 nav document, falling back to the EPUB 2 NCX.
  const toc = [];
  const pushEntry = (label, href, base, depth) => {
    if (!label || !href) return;
    const ch = chapterOf(resolvePath(base, href));
    if (ch !== undefined) toc.push({ label, ch, frag: fragmentOf(href), depth });
  };
  const navItem = [...manifest.values()].find((i) => i.props.includes('nav'));
  if (navItem && getFile(navItem.path)) {
    const navDoc = parseXhtml(await readText(navItem.path));
    const navs = [...navDoc.getElementsByTagNameNS('*', 'nav')];
    const nav = navs.find((n) => (n.getAttributeNS(OPS, 'type') || n.getAttribute('epub:type') || '').includes('toc')) ?? navs[0];
    const walk = (ol, depth) => {
      for (const li of ol?.children ?? []) {
        if (li.localName !== 'li') continue;
        const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
        if (a) pushEntry(text(a), a.getAttribute('href') || '', navItem.path, depth);
        walk([...li.children].find((c) => c.localName === 'ol'), depth + 1);
      }
    };
    if (nav) walk([...nav.getElementsByTagNameNS('*', 'ol')][0], 0);
  }
  if (!toc.length) {
    const ncxId = opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc');
    const ncx = manifest.get(ncxId) ?? [...manifest.values()].find((i) => i.type === 'application/x-dtbncx+xml');
    if (ncx && getFile(ncx.path)) {
      const ncxDoc = parseXml(await readText(ncx.path));
      const walk = (parent, depth) => {
        for (const np of parent?.children ?? []) {
          if (np.localName !== 'navPoint') continue;
          const label = text([...np.children].find((c) => c.localName === 'navLabel'));
          const src = [...np.children].find((c) => c.localName === 'content')?.getAttribute('src') || '';
          pushEntry(label, src, ncx.path, depth);
          walk(np, depth + 1);
        }
      };
      walk(ncxDoc?.getElementsByTagNameNS('*', 'navMap')[0], 0);
    }
  }

  // Resources -------------------------------------------------------------
  const cssCache = new Map();
  const imageUrls = new Map();

  async function loadSheet(path) {
    if (!cssCache.has(path)) {
      cssCache.set(path, getFile(path) ? readText(path).then(sheetFromText).catch(() => null) : Promise.resolve(null));
    }
    return cssCache.get(path);
  }

  async function imageUrl(path) {
    if (!imageUrls.has(path)) {
      imageUrls.set(path, (async () => {
        const f = getFile(path);
        if (!f) return null;
        const ext = path.split('.').pop().toLowerCase();
        const data = await f.async('arraybuffer');
        return URL.createObjectURL(new Blob([data], { type: MIME[ext] || 'application/octet-stream' }));
      })());
    }
    return imageUrls.get(path);
  }

  // Chapter conversion ------------------------------------------------------
  async function loadChapter(ch) {
    const path = spine[ch];
    const doc = parseXhtml(await readText(path));

    const sheets = [];
    for (const el of doc.querySelectorAll('link, style')) {
      if (el.localName === 'style') {
        const s = sheetFromText(el.textContent);
        if (s) sheets.push(s);
      } else if ((el.getAttribute('rel') || '').toLowerCase().includes('stylesheet') && el.getAttribute('href')) {
        const s = await loadSheet(resolvePath(path, el.getAttribute('href')));
        if (s) sheets.push(s);
      }
    }
    const styleMap = buildStyleMap(doc, sheets);
    const ctx = { ch, path, counter: 0, words: 0, images: [] };

    const convert = (node) => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        const t = node.data;
        const m = t.match(/\S+/g);
        if (m) ctx.words += m.length;
        return document.createTextNode(t);
      }
      if (node.nodeType !== 1) return null;
      const tag = node.localName.toLowerCase();
      if (DROP.has(tag)) return null;

      let props = styleMap.get(node) || null;
      const inline = node.getAttribute('style');
      if (inline) {
        const ip = parseInlineStyle(inline);
        if (ip) props = { ...(props || {}), ...ip };
      }
      if (props?.hidden) return null;

      if (tag === 'svg') {
        const image = [...node.getElementsByTagNameNS('*', 'image')][0];
        const href = image && (image.getAttributeNS(XLINK, 'href') || image.getAttribute('xlink:href') || image.getAttribute('href'));
        if (!href) return null;
        const img = document.createElement('img');
        ctx.images.push({ img, path: resolvePath(path, href) });
        return img;
      }

      const mapped = KEEP.has(tag) ? tag : RENAME[tag];
      if (!mapped) {
        // Unknown element (MathML, epub-specific, ...): keep its content.
        const frag = document.createDocumentFragment();
        for (const c of node.childNodes) {
          const out = convert(c);
          if (out) frag.append(out);
        }
        return frag;
      }

      const out = document.createElement(mapped);
      const id = node.getAttribute('id') || node.getAttribute('xml:id');
      if (id) out.id = `x${ch}_${id}`;
      for (const a of COPY_ATTRS) {
        const v = node.getAttribute(a);
        if (v != null) out.setAttribute(a, v);
      }
      const lang = node.getAttribute('lang') || node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang');
      if (lang) out.lang = lang;
      if (mapped === 'ol' && node.getAttribute('type')) out.type = node.getAttribute('type');
      if (mapped === 'li' && node.getAttribute('value')) out.value = node.getAttribute('value');

      if (mapped === 'img') {
        const src = node.getAttribute('src');
        if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
        ctx.images.push({ img: out, path: resolvePath(path, src) });
      }

      if (mapped === 'a') {
        const href = node.getAttribute('href') ?? node.getAttributeNS(XLINK, 'href');
        if (href) {
          if (/^(https?:|mailto:)/i.test(href)) {
            out.href = href;
            out.target = '_blank';
            out.rel = 'noopener noreferrer';
          } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            const target = chapterOf(resolvePath(path, href));
            if (target !== undefined) {
              const frag = fragmentOf(href);
              out.href = '#';
              out.dataset.link = frag ? `x${target}_${frag}` : `ch${target}`;
            }
          }
        }
      }

      if (props) {
        const s = styleString(props);
        if (s) out.setAttribute('style', s);
      }
      if (BLOCK.has(mapped)) out.dataset.p = `${ch}.${ctx.counter++}`;

      for (const c of node.childNodes) {
        const child = convert(c);
        if (child) out.append(child);
      }
      return out;
    };

    const body = doc.body ?? doc.getElementsByTagNameNS('*', 'body')[0] ?? doc.documentElement;
    const root = document.createDocumentFragment();
    for (const c of body.childNodes) {
      const out = convert(c);
      if (out) root.append(out);
    }
    normalize(root, true);
    flattenTop(root);

    await Promise.all(ctx.images.map(async ({ img, path: p }) => {
      const url = await imageUrl(p).catch(() => null);
      if (!url) { img.remove(); return; }
      img.src = url;
      if (!img.alt) img.alt = '';
      await img.decode().catch(() => {});
    }));

    return { nodes: [...root.children], words: ctx.words };
  }

  async function dispose() {
    for (const p of imageUrls.values()) {
      const url = await p.catch(() => null);
      if (url) URL.revokeObjectURL(url);
    }
    imageUrls.clear();
  }

  // Cover image: EPUB 3 `cover-image` property, or the EPUB 2 <meta name="cover">.
  async function cover() {
    let item = [...manifest.values()].find((i) => i.props.includes('cover-image'));
    if (!item) {
      const metaCover = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover');
      item = manifest.get(metaCover?.getAttribute('content'));
    }
    if (!item || !item.type.startsWith('image/')) return null;
    const f = getFile(item.path);
    if (!f) return null;
    return new Blob([await f.async('arraybuffer')], { type: item.type });
  }

  return { meta, spine, toc, loadChapter, cover, dispose };
}

/** Metadata and a small cover thumbnail (used when importing). */
export async function readMetadata(buffer) {
  const book = await openEpub(buffer);
  let thumb = null;
  try { thumb = await thumbnail(await book.cover()); } catch { /* no cover */ }
  return { ...book.meta, chapters: book.spine.length, cover: thumb };
}

async function thumbnail(blob, width = 240) {
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, width / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// ---------------------------------------------------------------------------
// Structural clean-up so the paginator only ever sees either block containers
// (with block children) or leaf blocks (with inline content only).

const isBlockEl = (n) => n.nodeType === 1 && BLOCK.has(n.localName);
const hasContent = (n) => n.nodeType === 1 || /\S/.test(n.data);

function normalize(parent, forceBlocks = false) {
  const kids = [...parent.childNodes];
  if (forceBlocks || kids.some(isBlockEl)) {
    let run = [];
    const flush = (before) => {
      if (run.some(hasContent)) {
        const p = document.createElement('p');
        parent.insertBefore(p, before);
        p.append(...run);
      } else {
        run.forEach((n) => n.remove());
      }
      run = [];
    };
    for (const k of kids) {
      if (isBlockEl(k)) flush(k);
      else run.push(k);
    }
    flush(null);
  }
  for (const k of [...parent.children]) {
    if (!BLOCK.has(k.localName)) continue;
    normalize(k);
    if (k.localName === 'div' && ![...k.children].some(isBlockEl)) {
      const empty = !/\S/.test(k.textContent) && !k.querySelector('img, br');
      if (empty && !k.id) { k.remove(); continue; }
      if (!empty) {
        const p = document.createElement('p');
        for (const a of k.attributes) p.setAttribute(a.name, a.value);
        p.append(...k.childNodes);
        k.replaceWith(p);
      }
    }
  }
}

// Unwrap plain top-level <div> wrappers (often a whole chapter) so the
// paginator can work with many small blocks rather than one huge one.
function flattenTop(root) {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const el of [...root.children]) {
      if (el.localName !== 'div' || el.hasAttribute('style') || !el.firstElementChild) continue;
      if (el.id) {
        const first = el.firstElementChild;
        if (!first.id) first.id = el.id;
        else {
          const anchor = document.createElement('div');
          anchor.id = el.id;
          el.before(anchor);
        }
      }
      el.replaceWith(...el.childNodes);
      changed = true;
    }
    if (!changed) break;
  }
}
