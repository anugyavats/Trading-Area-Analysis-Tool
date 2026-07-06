let DATA = [];

// ---------- helpers ----------
const fmt = (v, d=1) => (v===null||v===undefined||isNaN(v)) ? '—' : Number(v).toLocaleString('en-IN',{maximumFractionDigits:d, minimumFractionDigits:0});
const fmtPct = v => (v===null||v===undefined||isNaN(v)) ? '—' : (v>0?'+':'')+v.toFixed(1)+'%';
const pctClass = v => (v===null||v===undefined||isNaN(v)) ? '' : (v>=0?'pos':'neg');
const esc = s => (s===null||s===undefined)?'':String(s);
const titleCase = s => s ? s.toString().replace(/\w\S*/g, t => t.charAt(0).toUpperCase()+t.substr(1).toLowerCase()) : s;

function label2(f){ return {omc:'Oil Company', mclass:'Market Class', urh:'Road Type'}[f]; }

// ---------- state ----------
let SA_LIST = [];
let selectedSA = null;
let current = null;
let peerSortCol = 'msC', peerSortDir = -1;
let subGroupField = 'none';

// ---------- dependency-free SVG bar chart helpers ----------
function escXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Single-series vertical bar chart. opts: {labels, values, colors, unitLabel}
function renderBarChart(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { labels, values, colors, unitLabel, title } = opts;
  const n = values.length;
  const barW = 30, gap = 18, leftPad = 60, topPad = 26, bottomPad = 95;
  const chartH = 190;
  const w = Math.max(leftPad*2 + n*(barW+gap), 900);
  const h = topPad + chartH + bottomPad;
  const maxV = Math.max(1, ...values.map(v=>v||0));
  const niceMax = maxV * 1.18;

  let bars = '';
  for(let i=0;i<n;i++){
    const v = values[i] || 0;
    const x = leftPad + gap + i*(barW+gap);
    const barH = niceMax>0 ? (chartH * (v/niceMax)) : 0;
    const y = topPad + (chartH - barH);
    const color = colors[i];
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,1)}" rx="3" fill="${color}"></rect>`;
    bars += `<text class="bar-value-label" x="${x+barW/2}" y="${y-6}" text-anchor="middle">${fmt(v,0)}</text>`;
    const lblY = topPad + chartH + 12;
    const lblX = x + barW/2;
    const label = labels[i].length > 16 ? labels[i].slice(0,15)+'…' : labels[i];
    bars += `<text class="bar-axis-label" x="0" y="0" text-anchor="end" transform="translate(${lblX},${lblY}) rotate(-25)">${escXml(label)}</text>`;
  }
  const baseline = `<line x1="${leftPad}" y1="${topPad+chartH}" x2="${w-leftPad}" y2="${topPad+chartH}" stroke="#DAD4C2" stroke-width="1"></line>`;

  el.innerHTML = `
    ${title ? `<div class="chart-title">${escXml(title)}</div>` : ''}
    <div class="svg-chart-scroll">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        ${baseline}
        ${bars}
      </svg>
    </div>`;
}


// ---------- DOM refs ----------
const saSelect = document.getElementById('saSelect');
const searchInput = document.getElementById('searchInput');
const dropdown = document.getElementById('dropdown');
const emptyState = document.getElementById('emptyState');

function resetToEmptyState(){
  current = null;
  document.getElementById('appGrid').classList.remove('open');
  emptyState.style.display = '';
}

function wireEvents(){
  saSelect.addEventListener('change', () => {
    selectedSA = saSelect.value;
    searchInput.value = '';
    dropdown.classList.remove('open');
    resetToEmptyState();
    searchInput.focus();
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if(q.length < 2){ dropdown.classList.remove('open'); return; }
    // Search is scoped to the selected Sales Area. Match on dealer name first
    // (primary), then fall back to trading area / location matches, so typing
    // an area name (e.g. "Vita") surfaces dealers located there.
    const scope = DATA.filter(d => d.sa === selectedSA);
    const nameMatches = scope.filter(d => d.name.toLowerCase().includes(q));
    const areaMatches = scope.filter(d =>
      !d.name.toLowerCase().includes(q) &&
      ((d.tarea && d.tarea.toLowerCase().includes(q)) || (d.location && d.location.toLowerCase().includes(q)))
    );
    const matches = [...nameMatches, ...areaMatches].slice(0,40);
    if(matches.length===0){
      dropdown.innerHTML = '<div class="dropdown-empty">No dealership, trading area, or location in '+esc(selectedSA)+' matches “'+esc(searchInput.value)+'”.</div>';
    } else {
      dropdown.innerHTML = matches.map(d => {
        const matchedArea = !d.name.toLowerCase().includes(q);
        return `<div class="dropdown-item" data-id="${d.id}">
           <span class="dn">${esc(d.name)}</span>
           <span class="dm">${matchedArea ? '<strong>'+esc(d.tarea && d.tarea.toLowerCase().includes(q) ? d.tarea : d.location)+'</strong> · ' : ''}${esc(d.location)||''} · ${esc(d.omc)}</span>
         </div>`;
      }).join('');
    }
    dropdown.classList.add('open');
  });

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.dropdown-item');
    if(!item) return;
    const id = Number(item.dataset.id);
    const d = DATA.find(x=>x.id===id);
    if(d) selectDealer(d);
    dropdown.classList.remove('open');
  });

  document.addEventListener('click', e => {
    if(!e.target.closest('.search-wrap')) dropdown.classList.remove('open');
  });
}

// ---------- load data, then boot the app ----------
async function init(){
  saSelect.disabled = true;
  searchInput.disabled = true;
  searchInput.placeholder = 'Loading dealer data…';
  try {
    const res = await fetch('dealers.json');
    if(!res.ok) throw new Error('HTTP '+res.status);
    DATA = await res.json();
  } catch(err){
    emptyState.innerHTML = `
      <div class="glyph">⚠</div>
      <h2>Couldn't load dealer data</h2>
      <p>Make sure <code>dealers.json</code> is sitting in the same folder as this page, and that you're viewing it over http(s) — e.g. via GitHub Pages or a local server — rather than double-clicking the file, since browsers block local file fetches. (${esc(err.message)})</p>
    `;
    return;
  }

  SA_LIST = [...new Set(DATA.map(d=>d.sa).filter(Boolean))].sort();
  selectedSA = SA_LIST.includes('SANGLI') ? 'SANGLI' : SA_LIST[0];
  saSelect.innerHTML = SA_LIST.map(sa=>`<option value="${esc(sa)}" ${sa===selectedSA?'selected':''}>${esc(sa)}</option>`).join('');
  saSelect.disabled = false;
  searchInput.disabled = false;
  searchInput.placeholder = 'Search by dealership name, trading area, or location…';

  wireEvents();
}
init();

// ---------- select dealer ----------
function selectDealer(d){
  current = d;
  peerSortCol = 'msC'; peerSortDir = -1;
  subGroupField = 'none';
  searchInput.value = d.name;
  document.getElementById('emptyState').style.display='none';
  document.getElementById('appGrid').classList.add('open');
  renderProfile();
  renderPeerSection();
}

// ---------- profile card ----------
function renderProfile(){
  const d = current;
  const card = document.getElementById('profileCard');
  const tArea = d.tarea ? d.tarea : null;
  card.innerHTML = `
    <div class="pname">${esc(d.name)}</div>
    <div class="ploc">${esc(titleCase(d.location))||'Location n/a'} · ${esc(d.dist)}</div>
    <div class="tagrow">
      <span class="tag omc-${esc(d.omc)}">${esc(d.omc)||'OMC N/A'}</span>
      <span class="tag">${esc(d.sa)}</span>
      <span class="tag">CLASS ${esc(d.mclass)||'—'}</span>
      <span class="tag">${esc(d.urh)||'—'}</span>
    </div>
    <div class="odo-grid">
      <div class="odo">
        <div class="odo-label">MS this month</div>
        <div class="odo-val">${fmt(d.msC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(d.msPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(d.msPct)} vs last year</div>
      </div>
      <div class="odo">
        <div class="odo-label">HSD this month</div>
        <div class="odo-val">${fmt(d.hsdC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(d.hsdPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(d.hsdPct)} vs last year</div>
      </div>
      <div class="odo">
        <div class="odo-label">MS cumulative FY</div>
        <div class="odo-val">${fmt(d.msCumC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(d.msCumPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(d.msCumPct)} vs last year</div>
      </div>
      <div class="odo">
        <div class="odo-label">HSD cumulative FY</div>
        <div class="odo-val">${fmt(d.hsdCumC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(d.hsdCumPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(d.hsdCumPct)} vs last year</div>
      </div>
    </div>
    <div class="profile-meta">
      <div class="meta-item"><div class="ml">Trading Area</div><div class="mv">${esc(tArea)||'Not mapped'}</div></div>
      <div class="meta-item"><div class="ml">Year Commissioned</div><div class="mv">${esc(d.yearcomm)||'—'}</div></div>
      <div class="meta-item"><div class="ml">Major NH</div><div class="mv">${esc(d.nh)||'—'}</div></div>
      <div class="meta-item"><div class="ml">Dealer Code</div><div class="mv">${esc(d.cn)||'—'}</div></div>
    </div>
    <div class="meta-note">${tArea ? 'Peer comparison below is scoped to dealers sharing this exact trading area.' : 'This dealer has no trading area mapped in the source workbook, so a trading-area peer comparison isn’t available. Trading areas are populated almost exclusively for the Sangli sales area.'}</div>
  `;
}


function renderHistorical(d){
 const el=document.getElementById('historicalPanel');
 if(!el) return;
 el.innerHTML=`
 <div class="section-head"><div><h3>Historical Comparison</h3><div class="sd">Current vs Historical (same period)</div></div></div>
 <div class="stat-strip">
   <div class="stat-box"><div class="sl">MS</div><div class="sv">${fmt(d.msC)} <span class="unit">| ${fmt(d.msH)}</span></div></div>
   <div class="stat-box"><div class="sl">HSD</div><div class="sv">${fmt(d.hsdC)} <span class="unit">| ${fmt(d.hsdH)}</span></div></div>
   <div class="stat-box"><div class="sl">MS Cum</div><div class="sv">${fmt(d.msCumC)} <span class="unit">| ${fmt(d.msCumH)}</span></div></div>
   <div class="stat-box"><div class="sl">HSD Cum</div><div class="sv">${fmt(d.hsdCumC)} <span class="unit">| ${fmt(d.hsdCumH)}</span></div></div>
 </div>
 <div class="two-col">
   <div class="chart-wrap"><div id="histMS"></div></div>
   <div class="chart-wrap"><div id="histHSD"></div></div>
 </div>`;
 renderBarChart('histMS',{
   labels:['Current','Historical'],
   values:[d.msC||0,d.msH||0],
   colors:['#0054A6','#E31E24'],
   unitLabel:'KL',
   title:'MS Current vs Historical'
 });
 renderBarChart('histHSD',{
   labels:['Current','Historical'],
   values:[d.hsdC||0,d.hsdH||0],
   colors:['#0054A6','#E31E24'],
   unitLabel:'KL',
   title:'HSD Current vs Historical'
 });
}

// ---------- Peer Comparison (Trading Area only) ----------
function renderPeerSection(){
  const d = current;
  const container = document.getElementById('peerContent');

  if(!d.tarea){
    container.innerHTML = `
      <div class="section-head">
        <div>
          <h3>No trading area mapped</h3>
          <div class="sd">This dealer doesn't have a trading area value in the source workbook, so a trading-area peer comparison can't be built.</div>
        </div>
      </div>
      <div class="note">Trading areas are populated almost exclusively for the <strong>Sangli</strong> sales area in this workbook. Switch the Sales Area filter above to Sangli, or search a different dealer within ${esc(d.sa)}, to see a peer comparison.</div>
    `;
    return;
  }

  const group = DATA.filter(x => x.sa===d.sa && x.tarea===d.tarea);

  const subFactors = [
    {k:'none', l:'None'},
    {k:'omc', l:'Oil Company'},
    {k:'mclass', l:'Market Class'},
    {k:'urh', l:'Road Type'},
  ];

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h3>Trading Area: ${esc(d.tarea)}</h3>
        <div class="sd">Comparing <strong>${esc(d.name)}</strong> against ${group.length} dealer${group.length===1?'':'s'} sharing this trading area in ${esc(d.sa)}.</div>
      </div>
    </div>
    <div id="peerStats"></div>
<div id="historicalPanel"></div>
    <div class="chart-wrap"><div id="peerChartMS"></div></div>
    <div class="chart-wrap"><div id="peerChartHSD"></div></div>

    <div class="section-head" style="margin-top:8px;">
      <div>
        <h3>Break these peers down further</h3>
        <div class="sd">Split the same trading-area peer group by another factor.</div>
      </div>
      <div class="group-toggle">${subFactors.map(f=>`<button class="chip ${f.k===subGroupField?'active':''}" data-sf="${f.k}">${f.l}</button>`).join('')}</div>
    </div>
    <div id="subGroupContent"></div>

    <div class="section-head" style="margin-top:8px;"><div><h3>All peers in ${esc(d.tarea)}</h3></div></div>
    <div class="table-scroll"><table class="dtable" id="peerTable"></table></div>
  `;

  container.querySelectorAll('[data-sf]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      subGroupField = chip.dataset.sf;
      drawSubGroup(group);
    });
  });

  renderHistorical(d);
  drawPeerStatsAndCharts(group);
  drawPeerTable(group);
  drawSubGroup(group);
}

function drawPeerStatsAndCharts(group){
  const d = current;
  const n = group.length;
  const rankOf = (arr, val) => {
    if(val===null||val===undefined) return null;
    const sorted = [...arr].filter(v=>v!==null&&v!==undefined).sort((a,b)=>b-a);
    return sorted.indexOf(val)+1;
  };
  const msVals = group.map(x=>x.msC);
  const hsdVals = group.map(x=>x.hsdC);
  const msRank = rankOf(msVals, d.msC);
  const hsdRank = rankOf(hsdVals, d.hsdC);
  const msValid = msVals.filter(v=>v!==null&&v!==undefined).length;
  const hsdValid = hsdVals.filter(v=>v!==null&&v!==undefined).length;
  const avgMs = msValid? (msVals.filter(v=>v!==null).reduce((a,b)=>a+b,0)/msValid) : null;
  const avgHsd = hsdValid? (hsdVals.filter(v=>v!==null).reduce((a,b)=>a+b,0)/hsdValid) : null;

  document.getElementById('peerStats').innerHTML = `
    <div class="stat-strip">
      <div class="stat-box"><div class="sl">Peer group size</div><div class="sv">${n} <span class="unit">dealers</span></div></div>
      <div class="stat-box"><div class="sl">MS rank</div><div class="sv">${msRank?('#'+msRank):'—'} <span class="unit">of ${msValid}</span></div></div>
      <div class="stat-box"><div class="sl">HSD rank</div><div class="sv">${hsdRank?('#'+hsdRank):'—'} <span class="unit">of ${hsdValid}</span></div></div>
      <div class="stat-box"><div class="sl">vs group average</div><div class="sv ${d.msC>avgMs?'pos':'neg'}">${avgMs? (d.msC>=avgMs?'+':'')+fmt(d.msC-avgMs):'—'} <span class="unit">KL MS</span></div></div>
    </div>
  `;

  // charts: sort group by msC desc, cap to 30 for readability, always include current
  function chartFor(containerId, key, unitLabel){
    const sorted = [...group].sort((a,b)=>(b[key]??-1)-(a[key]??-1));
    let shown = sorted;
    if(sorted.length>30){
      const idx = sorted.findIndex(x=>x.id===d.id);
      const start = Math.max(0, Math.min(idx-10, sorted.length-30));
      shown = sorted.slice(start, start+30);
    }
    const labels = shown.map(x=> x.id===d.id ? '★ '+x.name : x.name);
    const values = shown.map(x=>x[key]);
    const colors = shown.map(x=> x.id===d.id ? '#E31E24' : '#0054A6');
    renderBarChart(containerId, {
      labels, values, colors, unitLabel,
      title: unitLabel + ' — current month (★ = selected dealer)'
    });
  }
  chartFor('peerChartMS','msC','MS volume (KL)');
  chartFor('peerChartHSD','hsdC','HSD volume (KL)');
}

function drawPeerTable(group){
  const d = current;
  const cols = [
    {k:'name', l:'Dealer', num:false},
    {k:'omc', l:'OMC', num:false},
    {k:'location', l:'Location', num:false},
    {k:'mclass', l:'Class', num:false},
    {k:'urh', l:'Type', num:false},
    {k:'msC', l:'MS C', num:true},
    {k:'msH', l:'MS H', num:true},
    {k:'msPct', l:'MS Gr%', num:true},
    {k:'hsdC', l:'HSD C', num:true},
    {k:'hsdH', l:'HSD H', num:true},
    {k:'hsdPct', l:'HSD Gr%', num:true},
    {k:'msCumC', l:'MS Cum C', num:true},
    {k:'msCumH', l:'MS Cum H', num:true},
    {k:'hsdCumC', l:'HSD Cum C', num:true},
    {k:'hsdCumH', l:'HSD Cum H', num:true},
  ];
  const sorted = [...group];
  sorted.sort((a,b)=>{
    let av=a[peerSortCol], bv=b[peerSortCol];
    if(av===null||av===undefined) av = typeof bv==='string' ? '' : -Infinity;
    if(bv===null||bv===undefined) bv = typeof av==='string' ? '' : -Infinity;
    if(typeof av === 'string') return peerSortDir===1 ? av.localeCompare(bv) : bv.localeCompare(av);
    return peerSortDir===1 ? av-bv : bv-av;
  });

  const thead = '<thead><tr>'+cols.map(c=>`<th data-col="${c.k}">${c.l}${peerSortCol===c.k?(peerSortDir===1?' ▲':' ▼'):''}</th>`).join('')+'</tr></thead>';
  const rows = sorted.map(r=>{
    const cells = cols.map(c=>{
      if(!c.num) return `<td>${esc(r[c.k])||'—'}</td>`;
      const cls = c.k.includes('Pct') ? 'num '+pctClass(r[c.k]) : 'num';
      const val = c.k.includes('Pct') ? fmtPct(r[c.k]) : fmt(r[c.k]);
      return `<td class="${cls}">${val}</td>`;
    }).join('');
    return `<tr class="${r.id===d.id?'self-row':''}">${cells}</tr>`;
  }).join('');
  document.getElementById('peerTable').innerHTML = thead + '<tbody>'+rows+'</tbody>';
  document.querySelectorAll('#peerTable thead th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const col = th.dataset.col;
      if(peerSortCol===col) peerSortDir *= -1; else { peerSortCol=col; peerSortDir = -1; }
      drawPeerTable(group);
    });
  });
}

// ---------- Sub-grouping within the trading-area peer group ----------
function drawSubGroup(group){
  const d = current;
  const el = document.getElementById('subGroupContent');
  if(subGroupField === 'none'){ el.innerHTML = ''; return; }

  const groups = {};
  group.forEach(x=>{
    const k = x[subGroupField] || 'Unclassified';
    if(!groups[k]) groups[k] = {ms:0, hsd:0, n:0, msArr:[], hsdArr:[]};
    if(x.msC!==null){groups[k].ms += x.msC; groups[k].msArr.push(x.msC);}
    if(x.hsdC!==null){groups[k].hsd += x.hsdC; groups[k].hsdArr.push(x.hsdC);}
    groups[k].n++;
  });
  const keys = Object.keys(groups).sort();
  const myKey = d[subGroupField] || 'Unclassified';
  function avg(arr){ return arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

  el.innerHTML = `
    <div class="two-col">
      <div class="chart-wrap"><div id="subChartMS"></div></div>
      <div class="chart-wrap"><div id="subChartHSD"></div></div>
    </div>
    <div class="table-scroll"><table class="dtable" id="subTable"></table></div>
  `;

  renderBarChart('subChartMS', {
    labels: keys,
    values: keys.map(k=>avg(groups[k].msArr)),
    colors: keys.map(k=>k===myKey?'#E31E24':'#0054A6'),
    unitLabel: 'Avg MS / outlet (KL)',
    title: 'Avg MS per outlet by '+label2(subGroupField)+' — within this trading area'
  });
  renderBarChart('subChartHSD', {
    labels: keys,
    values: keys.map(k=>avg(groups[k].hsdArr)),
    colors: keys.map(k=>k===myKey?'#E31E24':'#E31E24'),
    unitLabel: 'Avg HSD / outlet (KL)',
    title: 'Avg HSD per outlet by '+label2(subGroupField)+' — within this trading area'
  });

  const thead = `<thead><tr><th>${label2(subGroupField)}</th><th>Outlets</th><th>Total MS (KL)</th><th>Avg MS (KL)</th><th>Total HSD (KL)</th><th>Avg HSD (KL)</th></tr></thead>`;
  const rows = keys.map(k=>{
    const g = groups[k];
    return `<tr class="${k===myKey?'self-row':''}"><td>${esc(k)}</td><td class="num">${g.n}</td><td class="num">${fmt(g.ms)}</td><td class="num">${fmt(avg(g.msArr))}</td><td class="num">${fmt(g.hsd)}</td><td class="num">${fmt(avg(g.hsdArr))}</td></tr>`;
  }).join('');
  document.getElementById('subTable').innerHTML = thead+'<tbody>'+rows+'</tbody>';
}