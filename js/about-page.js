// About page: quick-exit settings panel.

import {
  getQuickExit, setQuickExit, normalizeUrl, exitUrl, installQuickExit, quickExit, SHORTCUTS, OFFICE_URL,
} from './quickexit.js';

installQuickExit();

const panel = document.getElementById('quick-exit');
const $ = (sel) => panel.querySelector(sel);
const keySel = $('#qe-key');
const urlInput = $('#qe-url');
const status = $('#qe-status');

keySel.innerHTML = Object.entries(SHORTCUTS).map(([k, label]) => `<option value="${k}">${label}</option>`).join('');

function render() {
  const cfg = getQuickExit();
  $('#qe-enabled').checked = cfg.enabled;
  keySel.value = cfg.key;
  $(`input[name="qe-target"][value="${cfg.target}"]`).checked = true;
  if (document.activeElement !== urlInput) urlInput.value = cfg.url;
  urlInput.disabled = cfg.target !== 'custom';
  panel.classList.toggle('off', !cfg.enabled);
  const bad = cfg.target === 'custom' && !normalizeUrl(cfg.url);
  urlInput.classList.toggle('invalid', bad && !!cfg.url.trim());
  status.textContent = !cfg.enabled
    ? 'Quick exit is off.'
    : bad
      ? `Enter a web address. Until then, quick exit goes to ${OFFICE_URL.replace('https://', '').replace(/\/$/, '')}.`
      : `${SHORTCUTS[cfg.key]} → ${exitUrl(cfg).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
}

let flashTimer;
function saved() {
  render();
  const s = $('#qe-saved');
  s.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => s.classList.remove('show'), 1400);
}

$('#qe-enabled').addEventListener('change', (e) => { setQuickExit({ enabled: e.target.checked }); saved(); });
keySel.addEventListener('change', () => { setQuickExit({ key: keySel.value }); saved(); });
for (const r of panel.querySelectorAll('input[name="qe-target"]')) {
  r.addEventListener('change', () => {
    setQuickExit({ target: r.value });
    saved();
    if (r.value === 'custom') urlInput.focus();
  });
}
urlInput.addEventListener('input', () => { setQuickExit({ url: urlInput.value }); render(); });
urlInput.addEventListener('change', () => {
  const url = normalizeUrl(urlInput.value);
  if (url) urlInput.value = url;
  setQuickExit({ url: urlInput.value });
  saved();
});
$('#qe-test').addEventListener('click', quickExit);

render();
