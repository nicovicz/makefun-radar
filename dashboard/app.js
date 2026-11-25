// The board remains fixed; scenario controls only change the selected detail.
const data = window.RADAR;
const $ = s => document.querySelector(s);
const escapeText = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => n == null ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n).toLocaleString());
const dollars = n => '$' + Math.round(n).toLocaleString();
const pct = n => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const multiple = n => n.toFixed(4) + '×';
const defaults = {status:'early', sort:'rank', direction:'asc', watchlist:'', category:'', chain:'', tvl:'', growth:'', search:'', slug:'', weight:'0.5', floor:'0.75'};
const allowedSorts = ['rank','name','tvl_usd','change_7d','implied_value_usd'];
let state = {...defaults};
let visible = [];
const all = [...data.rows, ...data.live];
$('#date').textContent = data.as_of;
$('#total').textContent = data.rows.length;
$('#watch').textContent = data.watchlist_size;
for (const [selector, values] of [['#category', all.map(r => r.category || 'Unclassified')], ['#chain', all.flatMap(r => r.chains)]]) {
  for (const value of [...new Set(values)].sort()) $(selector).add(new Option(value, value));
}
function readURL() {
  const params = new URLSearchParams(location.search);
  state = {...defaults};
  for (const key of Object.keys(defaults)) if (params.has(key)) state[key] = params.get(key);
  // Continue accepting the original shared links.
  if (!params.has('status') && params.get('view') === 'live') state.status = 'live';
  if (!['early','live'].includes(state.status)) state.status = 'early';
  if (state.status === 'live' && !params.has('sort')) { state.sort = 'implied_value_usd'; state.direction = 'desc'; }
  if (!allowedSorts.includes(state.sort)) state.sort = 'rank';
  if (!['asc','desc'].includes(state.direction)) state.direction = 'asc';
  if (!['','small','mid','large'].includes(state.tvl)) state.tvl = '';
  if (!['','up','down','missing'].includes(state.growth)) state.growth = '';
  if (!['','only'].includes(state.watchlist)) state.watchlist = '';
  for (const [key, min, max] of [['weight',0,1],['floor',0.5,1]]) {
    const value = Number(state[key]);
    state[key] = Number.isFinite(value) ? String(Math.min(max, Math.max(min, value))) : defaults[key];
  }
  for (const key of ['watchlist','category','chain','tvl','growth','search']) {
    $('#' + key).value = state[key];
    state[key] = $('#' + key).value;
  }
}
function writeURL(push = false) {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) if (state[key] !== defaults[key] && state[key] !== '') params.set(key, state[key]);
  const query = params.toString();
  const url = location.pathname + (query ? '?' + query : '') + location.hash;
  if (url !== location.pathname + location.search + location.hash) history[push ? 'pushState' : 'replaceState'](null, '', url);
}
function filtered() {
  const q = state.search.trim().toLowerCase();
  return (state.status === 'early' ? data.rows : data.live).filter(r => {
    const match = !q || [r.name,r.slug,r.category,...r.chains].join(' ').toLowerCase().includes(q);
    const tvl = !state.tvl || (state.tvl === 'small' ? r.tvl_usd < 5e7 : state.tvl === 'mid' ? r.tvl_usd >= 5e7 && r.tvl_usd < 1e9 : r.tvl_usd >= 1e9);
    const growth = !state.growth || (state.growth === 'missing' ? r.change_7d == null : r.change_7d != null && (state.growth === 'up' ? r.change_7d > 0 : r.change_7d < 0));
    const watchMatch = !state.watchlist || r.watchlist === true;
    return match && watchMatch && tvl && growth && (!state.category || (r.category || 'Unclassified') === state.category) && (!state.chain || r.chains.includes(state.chain));
  }).sort((a,b) => {
    const av = a[state.sort], bv = b[state.sort];
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    const comparison = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return comparison * (state.direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name);
  });
}
function distribution(rows) {
  const points = rows.filter(r => r.tvl_usd > 0 && r.implied_value_usd > 0);
  if (!points.length) { $('#distribution').innerHTML = '<p class="plot-empty">No values to plot for this view.</p>'; return; }
  const logs = points.flatMap(r => [Math.log10(r.tvl_usd), Math.log10(r.implied_value_usd)]);
  const lo = Math.min(...logs), hi = Math.max(...logs), span = hi - lo || 1;
  const pos = n => 16 + (Math.log10(n) - lo) / span * 568;
  const marks = points.map(r => `<circle cx="${pos(r.tvl_usd).toFixed(2)}" cy="${(48 - (Math.log10(r.implied_value_usd) - lo) / span * 40).toFixed(2)}" r="${r.slug === state.slug ? 4 : 2.4}" class="${r.slug === state.slug ? 'plot-selected' : 'plot-dot'}"><title>${escapeText(r.name)}: TVL ${money(r.tvl_usd)}, ${state.status === 'early' ? 'implied value' : 'market cap'} ${money(r.implied_value_usd)}</title></circle>`).join('');
  $('#distribution').innerHTML = `<svg viewBox="0 0 600 56" preserveAspectRatio="none" role="img" aria-label="Horizontal position is TVL, vertical position is ${state.status === 'early' ? 'implied value' : 'market cap'}, logarithmic scales"><line x1="16" y1="48" x2="584" y2="8" class="plot-parity"/>${marks}</svg><div class="plot-axis"><span>${money(10 ** lo)}</span><span>TVL →</span><span>${money(10 ** hi)}</span></div>`;
}
function scenario(r) {
  const m = r.model, weight = Number(state.weight), floor = Number(state.floor);
  const momentum = 1 + m.growth / 100 * weight;
  const fraction = Math.min(r.age_days ?? 365, 730) / 730;
  const maturity = floor + (1 - floor) * fraction;
  const result = Math.max(1, Math.round(r.tvl_usd * m.multiple * momentum * maturity * m.breadth));
  return {momentum, maturity, result, fraction};
}
function detail(r) {
  const panel = $('#detail');
  if (!r) { panel.innerHTML = '<div class="label">PROTOCOL DETAIL</div><h3>No selection</h3><p class="sub">Change the filters to see a protocol.</p>'; return; }
  const early = state.status === 'early', m = r.model;
  panel.innerHTML = `<div class="label">${early ? 'PROTOCOL DETAIL / ' + String(r.rank).padStart(3,'0') : 'TOKEN RECORD'}</div><h3>${escapeText(r.name)}</h3><div class="sub">${escapeText(r.category || 'Unclassified')} · ${escapeText(r.chains.join(', ') || 'Chain not reported')}</div><div class="badge">${early ? escapeText(r.confidence.toUpperCase()) + ' CONFIDENCE' : 'TOKEN RECORDED'}</div><div class="label">${early ? 'RANKED IMPLIED VALUE' : 'RECORDED MARKET CAP'}</div><div class="detail-value">${money(r.implied_value_usd)}</div><div class="explain">${early ? 'Fixed board estimate; scenarios below do not change the ranking.' : 'Market cap from the snapshot; unavailable when not reported.'}</div>${early ? `<section class="calc"><div class="calc-heading"><div><div class="label">MODEL LAB</div><h4>Test the assumptions</h4></div><button id="reset-model" class="model-reset">Reset</button></div><p class="explain">Adjust two weights to explore a scenario. Category and breadth remain fixed.</p><label class="slider-label" for="weight">Momentum weight <output id="weight-value"></output></label><input class="slider" id="weight" type="range" min="0" max="1" step="0.05" value="${escapeText(state.weight)}"><label class="slider-label" for="floor">Maturity floor <output id="floor-value"></output></label><input class="slider" id="floor" type="range" min="0.5" max="1" step="0.05" value="${escapeText(state.floor)}"><div id="scenario-result" aria-live="polite"></div></section><h4>FIELD PLAN / ESTIMATES</h4><ol>${r.farm_steps.map(s => `<li>${escapeText(s)}</li>`).join('')}</ol><div class="record"><h4>SNAPSHOT RECORD</h4><div class="calc-row"><span>Listed</span><b>${escapeText(r.listed_at)}</b></div><div class="calc-row"><span>Watchlist</span><b>${r.watchlist ? 'Yes' : 'No'}</b></div><div class="calc-row"><span>Slug</span><b>${escapeText(r.slug)}</b></div></div>` : `<div class="calc"><div class="calc-row"><span>TVL</span><b>${money(r.tvl_usd)}</b></div><div class="calc-row"><span>7-day change</span><b>${pct(r.change_7d)}</b></div><div class="calc-row"><span>Symbol</span><b>${escapeText(r.symbol)}</b></div><div class="calc-row"><span>Listed</span><b>${escapeText(r.listed_at)}</b></div></div>`}`;
  if (early) updateScenario(r);
}
function updateScenario(r) {
  const m = r.model, s = scenario(r);
  $('#weight-value').textContent = Number(state.weight).toFixed(2) + '×';
  $('#floor-value').textContent = Number(state.floor).toFixed(2) + '×';
  $('#scenario-result').innerHTML = `<div class="scenario-total"><span>SCENARIO VALUE</span><strong>${dollars(s.result)}</strong></div><div class="calc-row"><span>TVL</span><b>${dollars(r.tvl_usd)}</b></div><div class="calc-row"><span>Category median · ${m.peer_count} peers${m.peer_count ? '' : ' / fallback'}</span><b>${multiple(m.multiple)}</b></div><div class="calc-row"><span>Momentum · ${pct(m.growth)} clamped × ${Number(state.weight).toFixed(2)}</span><b>${multiple(s.momentum)}</b></div><div class="calc-row"><span>Maturity · ${r.age_days == null ? '365d fallback' : r.age_days + 'd'} / 730d</span><b>${multiple(s.maturity)}</b></div><div class="calc-row"><span>Breadth · ${r.chains.length} chains</span><b>${multiple(m.breadth)}</b></div><p class="formula">${dollars(r.tvl_usd)} × ${multiple(m.multiple)} × ${multiple(s.momentum)} × ${multiple(s.maturity)} × ${multiple(m.breadth)} = ${dollars(s.result)}<br><span>Terms shown rounded; calculation uses full precision.</span></p>`;
}
function render() {
  document.querySelectorAll('[data-status]').forEach(b => { b.classList.toggle('active', b.dataset.status === state.status); b.setAttribute('aria-pressed', String(b.dataset.status === state.status)); });
  visible = filtered();
  if (!visible.some(r => r.slug === state.slug)) state.slug = visible[0]?.slug || '';
  $('#count').textContent = `/ ${visible.length} RESULTS`;
  $('#shown').textContent = `${visible.length} RECORDS · ${state.status === 'early' ? 'MODEL VIEW' : 'MARKET CAP VIEW'}`;
  $('#empty').hidden = visible.length > 0;
  document.querySelectorAll('[data-sort]').forEach(b => { const active = b.dataset.sort === state.sort; b.classList.toggle('sorting',active); b.setAttribute('aria-label', b.textContent.replace(/ [↑↓]$/, '') + (active ? ', sorted ' + state.direction : ', sort')); b.textContent = b.textContent.replace(/ [↑↓]$/, '') + (active ? (state.direction === 'asc' ? ' ↑' : ' ↓') : ''); });
  $('#rows').innerHTML = visible.map(r => `<tr class="data ${r.slug === state.slug ? 'selected' : ''}" data-slug="${escapeText(r.slug)}" aria-selected="${r.slug === state.slug}"><td class="rank">${r.rank ? String(r.rank).padStart(3,'0') : '—'}</td><td class="name">${escapeText(r.name)}${r.watchlist ? ' <span class="confidence higher">WATCH</span>' : ''}<small>${escapeText(r.category || 'Unclassified')} · ${escapeText(r.chains[0] || 'No chain')}</small></td><td>${money(r.tvl_usd)}</td><td class="${r.change_7d > 0 ? 'positive' : r.change_7d < 0 ? 'negative' : ''}">${pct(r.change_7d)}</td><td class="value">${money(r.implied_value_usd)}</td><td>${r.model ? `<span class="confidence ${r.confidence.toLowerCase()}">${escapeText(r.confidence)}</span><small class="peer-count">${r.model.peer_count} peers</small>` : '<span class="peer-count">Market cap</span>'}</td><td class="arrow">↗</td></tr>`).join('');
  distribution(visible);
  detail(visible.find(r => r.slug === state.slug));
  writeURL();
}
function selectRelative(offset) {
  if (!visible.length) return;
  const current = visible.findIndex(r => r.slug === state.slug);
  state.slug = visible[Math.max(0, Math.min(visible.length - 1, current + offset))].slug;
  writeURL(true); render();
  document.querySelector('tr.selected')?.scrollIntoView({block:'nearest'});
}
$('#rows').addEventListener('click', e => { const row = e.target.closest('tr[data-slug]'); if (row) { state.slug = row.dataset.slug; writeURL(true); render(); } });
document.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => { state.status = b.dataset.status; state.sort = state.status === 'early' ? 'rank' : 'implied_value_usd'; state.direction = state.status === 'early' ? 'asc' : 'desc'; state.slug = ''; writeURL(true); render(); }));
document.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { const key = b.dataset.sort; state.direction = state.sort === key ? (state.direction === 'asc' ? 'desc' : 'asc') : (key === 'name' || key === 'rank' ? 'asc' : 'desc'); state.sort = key; writeURL(true); render(); }));
for (const key of ['watchlist','category','chain','tvl','growth','search']) $('#' + key).addEventListener('input', e => { state[key] = e.target.value; state.slug = ''; writeURL(key !== 'search'); render(); });
$('#reset').addEventListener('click', () => { for (const key of ['watchlist','category','chain','tvl','growth','search']) { state[key] = ''; $('#' + key).value = ''; } state.slug = ''; writeURL(true); render(); });
$('#detail').addEventListener('input', e => { if (e.target.id === 'weight' || e.target.id === 'floor') { state[e.target.id] = e.target.value; writeURL(); const row = visible.find(r => r.slug === state.slug); if (row?.model) updateScenario(row); } });
$('#detail').addEventListener('click', e => { if (e.target.id === 'reset-model') { state.weight = defaults.weight; state.floor = defaults.floor; writeURL(true); detail(visible.find(r => r.slug === state.slug)); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (state.search) { state.search = ''; $('#search').value = ''; state.slug = ''; writeURL(true); render(); } return; }
  if (e.target.matches('input, select, textarea, button') || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['j','ArrowDown','k','ArrowUp'].includes(e.key)) { e.preventDefault(); selectRelative(e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1); }
  if (e.key === 'Enter' && state.slug) { e.preventDefault(); $('#detail').focus(); $('#detail').scrollIntoView({block:'nearest'}); }
});
window.addEventListener('popstate', () => { readURL(); render(); });
readURL();
render();
