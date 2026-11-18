// PeerLens dashboard: a static page over window.RADAR_DATA, written beside it by main.ts.
// No framework, no network: the board, a detail view per protocol, a launched reference table,
// and the model's method and validation, all rendered from the one data file.
(function () {
  'use strict';
  var D = window.RADAR_DATA;
  var meta = D.meta;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v == null) return '<span class="mut">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'mut';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(v) { return v == null ? '—' : v.toFixed(1) + 'y'; }
  function el(id) { return document.getElementById(id); }

  // ---- masthead stats -------------------------------------------------------
  el('asof').innerHTML = 'Snapshot as of <b>' + esc(meta.as_of) + '</b><br>DefiLlama sealed snapshot';
  el('stats').innerHTML = [
    [meta.n_protocols, 'protocols scanned'],
    [meta.n_candidates, 'pre-token candidates'],
    [meta.n_watchlist + ' / ' + meta.n_watchlist, 'watchlist covered'],
    [meta.n_launched, 'launched peers priced from'],
    ['ρ ' + meta.backtest.spearman.toFixed(3), 'backtest rank score'],
    ['×' + meta.backtest.median_ratio_after.toFixed(2), 'median value accuracy'],
  ].map(function (s) {
    return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>';
  }).join('');

  // ---- board ----------------------------------------------------------------
  var catSel = el('f-category');
  var ecoSel = el('f-ecosystem');
  Array.from(new Set(rows.map(function (r) { return r.category || '(none)'; }))).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  Array.from(new Set(rows.map(function (r) { return r.ecosystem; }))).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; ecoSel.appendChild(o);
  });

  function currentRows() {
    var q = el('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var eco = ecoSel.value;
    var watchOnly = el('f-watch').checked;
    var sort = el('f-sort').value;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && (r.category || '(none)') !== cat) return false;
      if (eco && r.ecosystem !== eco) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
    var key = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_years == null ? -1 : b.age_years) - (a.age_years == null ? -1 : a.age_years); },
      multiple: function (a, b) { return b.multiple - a.multiple; },
    }[sort];
    out.sort(key);
    return out;
  }

  function renderBoard() {
    var list = currentRows();
    el('showing').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
    el('rows').innerHTML = list.map(function (r) {
      return '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_years) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('tr.row'), function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }
  ['q', 'f-category', 'f-ecosystem', 'f-watch', 'f-sort'].forEach(function (id) {
    el(id).addEventListener('input', renderBoard);
    el(id).addEventListener('change', renderBoard);
  });

  // ---- launched reference -----------------------------------------------------
  el('live-rows').innerHTML = D.live.map(function (r) {
    return '<tr><td><span class="pname">' + esc(r.name) + '</span></td>' +
      '<td>' + esc(r.symbol || '—') + '</td><td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + money(r.mcap_usd) + '</td>' +
      '<td class="num">' + (r.ratio == null ? '—' : r.ratio.toFixed(2) + '×') + '</td></tr>';
  }).join('');

  // ---- views ------------------------------------------------------------------
  var views = { board: el('view-board'), detail: el('view-detail'), live: el('view-live'), method: el('view-method') };
  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    });
    window.scrollTo(0, 0);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { show(t.getAttribute('data-view')); });
  });

  renderBoard();

  // ---- detail view ------------------------------------------------------------
  function factor(now, before) {
    if (!before) return '—';
    var f = now / before;
    return (f >= 1 ? '×' : '×') + f.toFixed(2);
  }
  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var w = r.waterfall;
    var html = '';
    html += '<button class="back" id="back">← Back to the board</button>';
    html += '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="chip">rank #' + r.rank + ' of ' + rows.length + '</span>' +
      (r.watchlist ? '<span class="badge">house watchlist</span>' : '') +
      '<span class="chip">' + esc(r.category || 'no category') + '</span>' +
      '<span class="chip">' + esc(r.ecosystem) + '</span></div>';
    html += '<div class="grid">' +
      '<div class="card"><span>Implied launch value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div class="card"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="card"><span>Implied multiple</span><b>' + r.multiple.toFixed(2) + '× TVL</b></div>' +
      '<div class="card"><span>TVL change, 7d</span><b>' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div class="card"><span>Tracked since</span><b>' + (r.listed_at || '—') + '</b></div>' +
      '<div class="card"><span>Years with no token</span><b>' + (r.age_years == null ? '—' : r.age_years.toFixed(1)) + '</b></div>' +
      '<div class="card"><span>Chains</span><b>' + r.chains.length + '</b></div>' +
      '</div>';
    html += '<p class="mut">' + esc(r.name) + ' runs on ' + esc(r.chains.join(', ') || '—') + '. It records no token on DefiLlama, which is not proof it has none.</p>';

    html += '<h3 class="section">How this value is built</h3>';
    html += '<table class="mini"><tr><th>Layer</th><th>What it does</th><th class="num">Factor</th><th class="num">Value so far</th></tr>' +
      '<tr><td>Size line</td><td>What protocols of this TVL are worth once launched, from the fitted size line over the launched set, calibration included.</td><td class="num">—</td><td class="num">' + money(w.size_usd) + '</td></tr>' +
      '<tr><td>Category peers</td><td>How ' + esc(r.category || 'uncategorised') + ' launches have priced against the size line, shrunk by how many there are.</td><td class="num">' + factor(w.category_usd, w.size_usd) + '</td><td class="num">' + money(w.category_usd) + '</td></tr>' +
      '<tr><td>Ecosystem</td><td>How ' + esc(r.ecosystem) + '-first protocols have priced after the category is counted.</td><td class="num">' + factor(w.ecosystem_usd, w.category_usd) + '</td><td class="num">' + money(w.ecosystem_usd) + '</td></tr>' +
      '<tr><td>Momentum &amp; age</td><td>Seven-day TVL growth and years run with no token. Kept deliberately weak: the backtest gives them little weight of their own.</td><td class="num">' + factor(w.implied_usd, w.ecosystem_usd) + '</td><td class="num"><b>' + money(w.implied_usd) + '</b></td></tr></table>';

    html += '<h3 class="section">Launched peers it is priced from</h3>';
    if (r.peers.length) {
      html += '<p class="mut">Nearest evidence: launched protocols in the same ' + (r.peers_from === 'category' ? 'category' : 'category and ecosystem') + ', by TVL.</p>';
      html += '<table class="mini"><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th></tr>' +
        r.peers.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.ratio.toFixed(2) + '×</td></tr>';
        }).join('') + '</table>';
    } else {
      html += '<p class="mut">No launched peer records both a TVL and a market cap in this group; the value rests on the size line and the wider effects.</p>';
    }

    html += '<h3 class="section">Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';

    views.detail.innerHTML = html;
    el('back').addEventListener('click', function () { show('board'); });
    show('detail');
  }

  // ---- method view --------------------------------------------------------------
  var bt = meta.backtest;
  views.method.innerHTML =
    '<div class="method">' +
    '<h3 class="section">What this radar claims</h3>' +
    '<p>Each board row is a protocol that <b>records no token</b> on DefiLlama — its record carries neither a CoinGecko id nor a symbol. That is not proof it has none. The implied value is this entry\'s own claim: what a token would be worth if the protocol launched at the snapshot\'s record. It is not a prediction that a token will be issued, or when.</p>' +
    '<h3 class="section">Who gets ranked</h3>' +
    '<p>The board ranks <b>' + meta.n_candidates + ' candidates</b>: every protocol that records no token, minus the wrapped, staked, bridged and versioned products of protocols whose tokens already trade (a V2 of a launched protocol is not a launch still to come), at every size in the snapshot — the house watchlist of ' + meta.n_watchlist + ' is a floor, not a ceiling, and every watchlist protocol is on the board. The other ' + (meta.n_protocols - meta.n_candidates) + ' protocols are either already launched (see the reference tab) or derivative products.</p>' +
    '<h3 class="section">The value model</h3>' +
    '<p><b>Layer 1 — a size line.</b> Over the ' + bt.n + ' launched protocols that record both a TVL and a market cap, log market cap is fitted against log TVL. The slope lands well under 1: doubling TVL much less than doubles launch value, so the biggest protocols carry the smallest multiples.</p>' +
    '<p><b>Layer 2 — partially pooled peer effects.</b> What the size line misses is averaged within each protocol\'s category, then within its primary-chain ecosystem. The averages are <i>shrunk toward zero by group size</i> (a category with four launches moves the estimate far less than one with forty) and <i>winsorised</i>, so one wild launch cannot bend a whole category. Eight fits that vary the shrinkage and the clip are averaged in log space; no protocol is priced off a hardcoded list of names.</p>' +
    '<p><b>Layer 3 — small tilts, then calibration.</b> Seven-day TVL growth and the years a protocol has run with no token tilt the value by a few percent at most. They are kept weak on purpose: in the backtest they carry little independent signal once size and peers are counted, and pretending otherwise would flatter the model. A single calibration multiplier (×' + meta.calibration.toFixed(3) + '), the median ratio of actual to predicted over the leave-one-out pass, removes the model\'s systematic bias.</p>' +
    '<h3 class="section">Validation, honestly</h3>' +
    '<p>The model grades itself the hard way: <b>leave-one-out</b> over all ' + bt.n + ' launched protocols — refit without each one, predict the one left out, compare with what its token is actually worth. Rank correlation (Spearman) between predicted and actual market caps: <b>' + bt.spearman.toFixed(3) + '</b>. Median predicted/actual: <b>' + bt.median_ratio_before.toFixed(3) + '</b> before calibration, <b>' + bt.median_ratio_after.toFixed(3) + '</b> after. The spread around that median is wide — individual launches land far from any model — so read the board as a ranking with a scale, not as price targets.</p>' +
    '<h3 class="section">Farm plans</h3>' +
    '<p>Every row carries a five-step plan built from its category and main chain: setup and gas budget, the core action with a capital band sized to the protocol, a twice-weekly cadence, a second deeper action, and the record-keeping that eligibility snapshots demand. Costs and times are stated in the steps themselves.</p>' +
    '</div>';
})();
