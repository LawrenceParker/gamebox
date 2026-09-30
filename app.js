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

let cfg = {}, items = [], boxes = [], achievements = [], rarities = {}, rarityOrder = [], games = [];
let game = '', save = null, lastDrop = null, base = 500, step = 0;

const fresh = () => ({ xp: Number(cfg.starting_xp) || 0, peak: 1, inv: {}, found: {}, pulls: {}, done: {}, title: '' });
const load = () => { try { return JSON.parse(localStorage.getItem(cfg.storage_key)); } catch { return null; } };
const persist = () => { try { localStorage.setItem(cfg.storage_key, JSON.stringify(save)); } catch {} };
const cur = () => cfg.currency_name || 'XP';

// Level thresholds: total XP needed to reach level L
const thr = L => base * (L - 1) + step * (L - 1) * (L - 2) / 2;
const levelOf = total => { let L = 1; while (thr(L + 1) <= total) L++; return L; };

function progress(a) {
  if (a.type === 'level') return levelOf(save.xp);
  if (a.type === 'level_drop') return Math.max(0, save.peak - levelOf(save.xp));
  const f = i => (!a.rarity || i.rarity === a.rarity) && (!a.game || i.game === a.game);
  const pool = items.filter(f);
  if (a.type === 'pulls') return pool.reduce((s, i) => s + (save.pulls[i.item_id] || 0), 0);
  if (a.type === 'unique') return pool.filter(i => save.found[i.item_id]).length;
  return 0;
}

function checkAchievements() {
  const got = []; let again = true;
  while (again) {
    again = false;
    save.peak = Math.max(save.peak || 1, levelOf(save.xp));
    for (const a of achievements) {
      if (save.done[a.achievement_id] || progress(a) < a.target) continue;
      save.done[a.achievement_id] = true;
      save.xp += a.reward_xp;
      if (a.reward_title) save.title = a.reward_title;
      got.push(a); again = true;
    }
  }
  if (got.length) setNotice('Achievement unlocked: ' + got.map(a => `${a.name}${a.reward_xp ? ` (+${a.reward_xp.toLocaleString()} ${cur()})` : ''}`).join(', '));
}

function setNotice(msg) { const n = $('#notice'); n.textContent = msg; n.hidden = !msg; }

function cardHTML(it, count, locked, coll) {
  const src = it.gif || it.image;
  const art = src && !locked
    ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${esc(it.item_name[0] || '?')}'))">`
    : (locked ? '?' : esc(it.item_name[0] || '?'));
  const color = (rarities[it.rarity] || {}).color || '#888';
  const gone = coll && !locked && count === 0;
  const badge = coll && !locked ? (gone ? 'sold' : count > 1 ? `×${count}` : '') : '';
  return `<div class="card ${locked ? 'locked' : ''} ${gone ? 'gone' : ''}" style="--rc:${esc(color)}">
    ${badge ? `<span class="count">${badge}</span>` : ''}
    <div class="art">${art}</div>
    <div class="name">${locked ? '???' : esc(it.item_name)}</div>
    <div class="meta"><span class="r">${esc(it.rarity)}</span><span>${it.value} ${esc(cur())}</span></div>
    ${coll && count > 0 ? `<div class="row" data-id="${esc(it.item_id)}"><button class="alt" data-sell="1">Sell</button>${count > 1 ? '<button class="alt" data-sell="dupes">Sell extras</button>' : ''}</div>` : ''}
  </div>`;
}

function render() {
  const lv = levelOf(save.xp), lo = thr(lv), hi = thr(lv + 1), pct = Math.min(100, (save.xp - lo) / (hi - lo) * 100);
  $('#level').textContent = `Level ${lv}`;
  $('#rank').textContent = save.title || '';
  $('#xpfill').style.width = pct + '%';
  $('#bar').setAttribute('aria-valuenow', Math.round(pct));
  $('#xpProgress').textContent = `${(save.xp - lo).toLocaleString()} / ${(hi - lo).toLocaleString()} ${cur()} to next level`;
  $('#xpTotal').textContent = `${save.xp.toLocaleString()} ${cur()}`;

  $('#games').innerHTML = games.map(g => `<button aria-pressed="${g === game}" data-game="${esc(g)}">${esc(g)}</button>`).join('');
  $('#boxes').innerHTML = boxes.map(b => {
    const odds = rarityOrder.filter(r => Number(b[r]) > 0).map(r => `${r} ${b[r]}`).join(', ');
    return `<div class="box"><strong>${esc(b.box_name)}</strong><span>${esc(b.description || '')}</span>
      <span class="odds">Weights: ${esc(odds)}</span>
      <button data-box="${esc(b.box_id)}" ${save.xp < Number(b.cost) || !items.length ? 'disabled' : ''}>Open for ${Number(b.cost).toLocaleString()} ${esc(cur())}</button></div>`;
  }).join('');

  const pool = items.filter(i => i.game === game);
  $('#progress').textContent = `${pool.filter(i => save.found[i.item_id]).length} / ${pool.length}`;
  const sorted = [...pool].sort((a, b) => rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity));
  $('#grid').innerHTML = sorted.map(i => cardHTML(i, save.inv[i.item_id] || 0, !save.found[i.item_id], true)).join('');

  $('#achProgress').textContent = `${achievements.filter(a => save.done[a.achievement_id]).length} / ${achievements.length}`;
  $('#achs').innerHTML = achievements.map(a => {
    const p = Math.min(progress(a), a.target), done = save.done[a.achievement_id];
    const reward = [a.reward_xp ? `+${a.reward_xp.toLocaleString()} ${cur()}` : '', a.reward_title ? `Title: ${a.reward_title}` : ''].filter(Boolean).join(' · ');
    return `<div class="ach ${done ? 'done' : ''}">
      <div class="top"><strong>${esc(a.name)}</strong><span class="muted">${done ? 'Done' : `${p.toLocaleString()} / ${a.target.toLocaleString()}`}</span></div>
      <div class="desc">${esc(a.description)}</div>
      <div class="bar"><div style="width:${p / a.target * 100}%"></div></div>
      ${reward ? `<div class="reward">${esc(reward)}</div>` : ''}</div>`;
  }).join('');
}

function openBox(id) {
  const box = boxes.find(b => b.box_id === id), cost = Number(box.cost);
  if (save.xp < cost || !items.length) return;
  const present = rarityOrder.filter(r => items.some(i => i.rarity === r) && Number(box[r]) > 0);
  const total = present.reduce((s, r) => s + Number(box[r]), 0);
  if (!total) { showError(`${box.box_name} has no possible drops. Check boxes.csv and items.csv.`); return; }
  setNotice('');
  let roll = Math.random() * total, rarity = present[present.length - 1];
  for (const r of present) { roll -= Number(box[r]); if (roll < 0) { rarity = r; break; } }
  const cands = items.filter(i => i.rarity === rarity);
  const it = cands[Math.floor(Math.random() * cands.length)];
  save.xp -= cost;
  save.inv[it.item_id] = (save.inv[it.item_id] || 0) + 1;
  save.pulls[it.item_id] = (save.pulls[it.item_id] || 0) + 1;
  save.found[it.item_id] = true;
  checkAchievements(); persist(); lastDrop = it;
  $('#revealCard').innerHTML = cardHTML(it, 0, false, false);
  $('#sellNow').textContent = `Sell for ${it.value} ${cur()}`;
  $('#reveal').showModal();
  render();
}

function sell(id, mode) {
  const it = items.find(i => i.item_id === id), n = save.inv[id] || 0;
  const qty = mode === 'dupes' ? n - 1 : 1;
  if (!it || qty < 1) return;
  setNotice('');
  save.inv[id] = n - qty;
  save.xp += qty * it.value;
  checkAchievements(); persist(); render();
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
  if (!confirm('Reset XP, level and collection?')) return;
  save = fresh(); setNotice(''); persist(); render();
};

(async function init() {
  try {
    const [s, it, bx, rr, ac] = await Promise.all(['settings', 'items', 'boxes', 'rarities', 'achievements'].map(n => loadCSV(`data/${n}.csv`)));
    cfg = Object.fromEntries(s.map(r => [r.key, r.value]));
    cfg.storage_key = cfg.storage_key || 'cardvault-save';
    base = Number(cfg.level_base_xp) > 0 ? Number(cfg.level_base_xp) : 500;
    step = Number(cfg.level_step_xp) || 0;
    items = it.map(i => ({ ...i, value: Number(i.value) || 0 }));
    boxes = bx;
    achievements = ac.filter(a => !/^(no|false|0)$/i.test(a.enabled || ''))
      .map(a => ({ ...a, target: Number(a.target) || 1, reward_xp: Number(a.reward_xp) || 0 }));
    rr.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    rr.forEach(r => rarities[r.rarity] = r);
    rarityOrder = rr.map(r => r.rarity);
    games = [...new Set(items.map(i => i.game))];
    game = games[0] || '';
    document.title = cfg.site_title || document.title;
    const types = ['pulls', 'unique', 'level', 'level_drop'], bad = [];
    achievements.forEach(a => {
      if (!types.includes(a.type)) bad.push(`${a.achievement_id}: unknown type "${a.type}"`);
      if (a.rarity && !rarityOrder.includes(a.rarity)) bad.push(`${a.achievement_id}: unknown rarity "${a.rarity}"`);
      if (a.game && !games.includes(a.game)) bad.push(`${a.achievement_id}: unknown game "${a.game}"`);
    });
    if (bad.length) showError('Check achievements.csv: ' + bad.join('; '));
    save = { ...fresh(), ...(load() || {}) };
    checkAchievements(); persist(); render();
  } catch (err) {
    showError(`${err.message}. Serve this folder over http (GitHub Pages or a local server) rather than opening index.html directly.`);
  }
})();
