const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(c => c.trim()))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
async function loadCSV(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return parseCSV(await res.text());
}

let cfg = {}, items = [], boxes = [], rarities = {}, rarityOrder = [], games = [];
let game = '', save = { credits: 0, inv: {} }, lastDrop = null;

const load = () => { try { return JSON.parse(localStorage.getItem(cfg.storage_key)); } catch { return null; } };
const persist = () => { try { localStorage.setItem(cfg.storage_key, JSON.stringify(save)); } catch {} };

function cardHTML(it, count, locked) {
  const src = it.gif || it.image;
  const art = src && !locked
    ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${esc(it.item_name[0] || '?')}'))">`
    : (locked ? '?' : esc(it.item_name[0] || '?'));
  const color = (rarities[it.rarity] || {}).color || '#888';
  return `<div class="card ${locked ? 'locked' : ''}" style="--rc:${esc(color)}">
    ${count > 1 ? `<span class="count">×${count}</span>` : ''}
    <div class="art">${art}</div>
    <div class="name">${locked ? '???' : esc(it.item_name)}</div>
    <div class="meta"><span class="r">${esc(it.rarity)}</span><span>${it.value}</span></div>
    ${count && !locked && !lastDrop ? `<div class="row" data-id="${esc(it.item_id)}"><button class="alt" data-sell="1">Sell</button>${count > 1 ? '<button class="alt" data-sell="dupes">Sell extras</button>' : ''}</div>` : ''}
  </div>`;
}

function render() {
  $('#credits').textContent = save.credits.toLocaleString();
  $('#games').innerHTML = games.map(g => `<button aria-pressed="${g === game}" data-game="${esc(g)}">${esc(g)}</button>`).join('');
  const pool = items.filter(i => i.game === game);
  $('#boxes').innerHTML = boxes.map(b => {
    const odds = rarityOrder.filter(r => Number(b[r]) > 0).map(r => `${r} ${b[r]}`).join(', ');
    return `<div class="box"><strong>${esc(b.box_name)}</strong><span>${esc(b.description || '')}</span>
      <span class="odds">Weights: ${esc(odds)}</span>
      <button data-box="${esc(b.box_id)}" ${save.credits < Number(b.cost) || !pool.length ? 'disabled' : ''}>Open for ${Number(b.cost).toLocaleString()}</button></div>`;
  }).join('');
  const owned = pool.filter(i => save.inv[i.item_id] > 0).length;
  $('#progress').textContent = `${owned} / ${pool.length}`;
  const sorted = [...pool].sort((a, b) => rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity));
  $('#grid').innerHTML = sorted.map(i => cardHTML(i, save.inv[i.item_id] || 0, !save.inv[i.item_id])).join('');
}

function openBox(id) {
  const box = boxes.find(b => b.box_id === id), cost = Number(box.cost);
  const pool = items.filter(i => i.game === game);
  if (save.credits < cost || !pool.length) return;
  const present = rarityOrder.filter(r => pool.some(i => i.rarity === r) && Number(box[r]) > 0);
  const total = present.reduce((s, r) => s + Number(box[r]), 0);
  if (!total) { showError(`${box.box_name} has no drops for ${game}. Check boxes.csv and items.csv.`); return; }
  let roll = Math.random() * total, rarity = present[present.length - 1];
  for (const r of present) { roll -= Number(box[r]); if (roll < 0) { rarity = r; break; } }
  const cands = pool.filter(i => i.rarity === rarity);
  const it = cands[Math.floor(Math.random() * cands.length)];
  save.credits -= cost;
  save.inv[it.item_id] = (save.inv[it.item_id] || 0) + 1;
  persist(); lastDrop = it;
  $('#revealCard').innerHTML = cardHTML(it, 0, false);
  $('#sellNow').textContent = `Sell for ${it.value}`;
  $('#reveal').showModal();
  render();
}

function sell(id, mode) {
  const it = items.find(i => i.item_id === id), n = save.inv[id] || 0;
  const qty = mode === 'dupes' ? n - 1 : 1;
  if (!it || qty < 1) return;
  save.inv[id] = n - qty; save.credits += qty * Number(it.value);
  persist(); render();
}

function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = false; }

document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.game) { game = t.dataset.game; render(); }
  else if (t.dataset.box) openBox(t.dataset.box);
  else if (t.dataset.sell) sell(t.closest('.row').dataset.id, t.dataset.sell);
});
$('#keep').onclick = () => { $('#reveal').close(); };
$('#sellNow').onclick = () => { const it = lastDrop; $('#reveal').close(); sell(it.item_id, '1'); };
$('#reveal').addEventListener('close', () => { lastDrop = null; render(); });
$('#reset').onclick = () => {
  if (!confirm('Reset credits and collection?')) return;
  save = { credits: Number(cfg.starting_credits) || 0, inv: {} }; persist(); render();
};

(async function init() {
  try {
    const [s, it, bx, rr] = await Promise.all(['settings', 'items', 'boxes', 'rarities'].map(n => loadCSV(`data/${n}.csv`)));
    cfg = Object.fromEntries(s.map(r => [r.key, r.value]));
    cfg.storage_key = cfg.storage_key || 'cardvault-save';
    items = it.map(i => ({ ...i, value: Number(i.value) || 0 }));
    boxes = bx;
    rr.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    rr.forEach(r => rarities[r.rarity] = r);
    rarityOrder = rr.map(r => r.rarity);
    games = [...new Set(items.map(i => i.game))];
    game = games[0] || '';
    document.title = $('#title').textContent = cfg.site_title || document.title;
    $('#currency').textContent = cfg.currency_name || '';
    const saved = load();
    save = saved || { credits: Number(cfg.starting_credits) || 0, inv: {} };
    if (!saved) persist();
    render();
  } catch (err) {
    showError(`${err.message}. Serve this folder over http (GitHub Pages or a local server) rather than opening index.html directly.`);
  }
})();
