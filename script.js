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
let fuelType = 'ms'; // 'ms' | 'hsd' | 'both'

// ---------- fuel-type accessors ----------
// The fuel filter (MS / HSD / MS+HSD) drives every fuel-specific view. These
// helpers translate the current fuelType into the right record fields so the
// rest of the code never hard-codes msC/hsdC etc.
const FUEL = {
  ms:   { label:'MS',     c:'msC',  h:'msH',  cumC:'msCumC',  cumH:'msCumH'  },
  hsd:  { label:'HSD',    c:'hsdC', h:'hsdH', cumC:'hsdCumC', cumH:'hsdCumH' },
  both: { label:'MS+HSD' },
};
function fuelLabel(){ return FUEL[fuelType].label; }
// which ∈ 'c' | 'h' | 'cumC' | 'cumH'
function fuelVal(d, which){
  if(fuelType === 'both'){
    const a = d[FUEL.ms[which]], b = d[FUEL.hsd[which]];
    if((a===null||a===undefined) && (b===null||b===undefined)) return null;
    return (a||0) + (b||0);
  }
  const v = d[FUEL[fuelType][which]];
  return (v===null||v===undefined) ? null : v;
}
// YoY growth derived uniformly from current vs historical (handles combined + h=0)
function fuelPct(d, cumulative){
  const c = fuelVal(d, cumulative ? 'cumC' : 'c');
  const h = fuelVal(d, cumulative ? 'cumH' : 'h');
  if(c===null || h===null || h===0) return null;
  return ((c - h) / h) * 100;
}

// ---------- OMC brand colours (from each oil company's logo) ----------
// IO = IndianOil (orange), BP = Bharat Petroleum (yellow), HP = HPCL (blue).
// The selected dealer is always drawn in brand red so it stands apart.
const OMC_COLORS = { IO:'#F26722', BP:'#F5C400', HP:'#0072BC' };
const OMC_NAMES  = { IO:'IOCL', BP:'BPCL', HP:'HPCL' };
const SELECTED_COLOR = '#E31E24';
function omcColor(omc){ return OMC_COLORS[omc] || '#8A99A8'; }
// Legend entries for the OMCs actually present in a set of dealers (+ selected).
function omcLegend(dealers){
  const present = [...new Set(dealers.map(x=>x.omc).filter(Boolean))]
    .filter(o=>OMC_COLORS[o]);
  const entries = present.map(o=>({color:OMC_COLORS[o], label:OMC_NAMES[o]||o}));
  entries.push({color:SELECTED_COLOR, label:'Selected dealer'});
  return entries;
}

// ---------- dependency-free SVG bar chart helpers ----------
function escXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Single-series vertical bar chart. opts: {labels, values, colors, unitLabel}
function renderBarChart(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { labels, values, colors, unitLabel, title, legend } = opts;
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
    const isSelf = labels[i].startsWith('★');
    const label = labels[i].length > 16 ? labels[i].slice(0,15)+'…' : labels[i];
    bars += `<text class="bar-axis-label${isSelf?' bar-axis-self':''}" x="0" y="0" text-anchor="end" transform="translate(${lblX},${lblY}) rotate(-25)">${escXml(label)}</text>`;
  }
  const baseline = `<line x1="${leftPad}" y1="${topPad+chartH}" x2="${w-leftPad}" y2="${topPad+chartH}" stroke="#DAD4C2" stroke-width="1"></line>`;

  el.innerHTML = `
    ${title ? `<div class="chart-title">${escXml(title)}</div>` : ''}
    ${legend ? `<div class="chart-legend">${legend.map(l=>`<span><span class="swatch" style="background:${l.color}"></span>${escXml(l.label)}</span>`).join('')}</div>` : ''}
    <div class="svg-chart-scroll">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        ${baseline}
        ${bars}
      </svg>
    </div>`;
}

// Diverging vertical bar chart with a zero baseline — bars go up for positive
// values (green) and down for negative (red). Used for the growth leaderboard.
function renderGrowthChart(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { labels, values, selfIdx, title } = opts;
  const n = values.length;
  const barW = 30, gap = 18, leftPad = 60, topPad = 22, bottomPad = 95;
  const half = 90; // px available above/below the zero line
  const w = Math.max(leftPad*2 + n*(barW+gap), 900);
  const h = topPad + half*2 + bottomPad;
  const zeroY = topPad + half;
  const maxAbs = Math.max(1, ...values.map(v=>Math.abs(v||0)));
  const niceMax = maxAbs * 1.15;

  let bars = '';
  for(let i=0;i<n;i++){
    const v = values[i] || 0;
    const x = leftPad + gap + i*(barW+gap);
    const barH = niceMax>0 ? (half * (Math.abs(v)/niceMax)) : 0;
    const y = v>=0 ? zeroY - barH : zeroY;
    const isSelf = i===selfIdx;
    const color = v>=0 ? '#1F9D55' : '#E31E24';
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,1)}" rx="3" fill="${color}" ${isSelf?'stroke="#1B2A41" stroke-width="2"':''}></rect>`;
    const vLblY = v>=0 ? y-6 : y+barH+13;
    bars += `<text class="bar-value-label" x="${x+barW/2}" y="${vLblY}" text-anchor="middle">${fmtPct(v)}</text>`;
    const lblY = topPad + half*2 + 12;
    const lblX = x + barW/2;
    let label = labels[i].length > 16 ? labels[i].slice(0,15)+'…' : labels[i];
    if(isSelf) label = '★ ' + label;
    bars += `<text class="bar-axis-label${isSelf?' bar-axis-self':''}" x="0" y="0" text-anchor="end" transform="translate(${lblX},${lblY}) rotate(-25)">${escXml(label)}</text>`;
  }
  const baseline = `<line x1="${leftPad}" y1="${zeroY}" x2="${w-leftPad}" y2="${zeroY}" stroke="#8A99A8" stroke-width="1"></line>`;

  el.innerHTML = `
    ${title ? `<div class="chart-title">${escXml(title)}</div>` : ''}
    <div class="svg-chart-scroll">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        ${baseline}
        ${bars}
      </svg>
    </div>`;
}

// Paired "Current vs Historical" mini panels — each panel is independently
// scaled so monthly figures aren't dwarfed by the much larger cumulative ones.
function renderComparePanels(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { panels, curColor='#0054A6', histColor='#E31E24' } = opts;
  function panelSvg(cur, hist){
    const W=220, H=190, barW=54, gap=44;
    const leftPad=(W-(barW*2+gap))/2, topPad=24, plotH=120;
    const baseY=topPad+plotH;
    const niceMax=Math.max(1, cur||0, hist||0)*1.22;
    const bar=(v,i,color,name)=>{
      const x=leftPad+i*(barW+gap);
      const bh=plotH*((v||0)/niceMax);
      const y=baseY-bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh,1)}" rx="4" fill="${color}"></rect>`
        +`<text class="bar-value-label" x="${x+barW/2}" y="${y-6}" text-anchor="middle">${fmt(v,0)}</text>`
        +`<text class="cmp-axis" x="${x+barW/2}" y="${baseY+16}" text-anchor="middle">${name}</text>`;
    };
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`
      +`<line x1="${leftPad-12}" y1="${baseY}" x2="${W-leftPad+12}" y2="${baseY}" stroke="#DAD4C2"></line>`
      +bar(cur,0,curColor,'Current')+bar(hist,1,histColor,'Last yr')
      +`</svg>`;
  }
  el.innerHTML = `
    <div class="chart-legend"><span><span class="swatch" style="background:${curColor}"></span>Current</span><span><span class="swatch" style="background:${histColor}"></span>Historical (last year)</span></div>
    <div class="cmp-row">
      ${panels.map(p=>`<div class="cmp-panel">
        <div class="cmp-title">${escXml(p.label)}${p.pct!==null&&p.pct!==undefined?` <span class="cmp-pct ${pctClass(p.pct)}">${fmtPct(p.pct)}</span>`:''}</div>
        ${panelSvg(p.cur, p.hist)}
      </div>`).join('')}
    </div>`;
}

// Donut — selected dealer's share of the trading-area total for the chosen fuel.
function renderDonut(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { value, total, label, contributors } = opts;
  const share = (total>0 && value!==null) ? (value/total)*100 : 0;
  const R = 70, cx = 90, cy = 90, sw = 26;
  const circ = 2 * Math.PI * R;
  const dash = (share/100) * circ;
  const ring = `
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#0054A6" stroke-width="${sw}" opacity="0.18"></circle>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#E31E24" stroke-width="${sw}"
      stroke-dasharray="${dash} ${circ-dash}" stroke-dashoffset="${circ*0.25}" stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"></circle>
    <text class="donut-pct" x="${cx}" y="${cy-2}" text-anchor="middle">${share.toFixed(1)}%</text>
    <text class="donut-sub" x="${cx}" y="${cy+16}" text-anchor="middle">of area</text>`;
  const contribHtml = (contributors && contributors.length) ? `
    <div class="contrib">
      <div class="contrib-head">Top 8 outlets in this area</div>
      ${contributors.map(c=>`
        ${c.gap?'<div class="contrib-gap">⋯</div>':''}
        <div class="contrib-row${c.self?' contrib-self':''}">
          <span class="contrib-rank">#${c.rank}</span>
          <span class="contrib-dot" style="background:${c.self?SELECTED_COLOR:omcColor(c.omc)}"></span>
          <span class="contrib-name" data-cid="${c.id}" title="View ${escXml(c.name)}">${escXml(c.name)}</span>
          <span class="contrib-val">${fmt(c.val,0)} KL</span>
          <span class="contrib-share">${c.share.toFixed(1)}%</span>
        </div>`).join('')}
    </div>` : '';
  el.innerHTML = `
    ${label ? `<div class="chart-title">${escXml(label)}</div>` : ''}
    <div class="donut-row">
      <svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">${ring}</svg>
      <div class="donut-legend">
        <div><span class="swatch" style="background:#E31E24"></span>This dealer — ${fmt(value)} KL</div>
        <div><span class="swatch" style="background:#0054A6;opacity:0.35"></span>Rest of area — ${fmt(total-(value||0))} KL</div>
        <div class="donut-total">Area total: <strong>${fmt(total)} KL</strong></div>
      </div>
    </div>
    ${contribHtml}`;
}

// Stacked bar — MS (navy) + HSD (red) per peer, to reveal product mix.
function renderStackedBar(containerId, opts){
  const el = document.getElementById(containerId);
  if(!el) return;
  const { labels, msVals, hsdVals, selfIdx, title } = opts;
  const n = labels.length;
  const barW = 30, gap = 18, leftPad = 60, topPad = 26, bottomPad = 95;
  const chartH = 190;
  const w = Math.max(leftPad*2 + n*(barW+gap), 900);
  const h = topPad + chartH + bottomPad;
  const totals = msVals.map((v,i)=>(v||0)+(hsdVals[i]||0));
  const maxV = Math.max(1, ...totals);
  const niceMax = maxV * 1.18;

  let bars = '';
  for(let i=0;i<n;i++){
    const ms = msVals[i]||0, hsd = hsdVals[i]||0, tot = ms+hsd;
    const x = leftPad + gap + i*(barW+gap);
    const msH = chartH * (ms/niceMax);
    const hsdH = chartH * (hsd/niceMax);
    const msY = topPad + (chartH - msH);
    const hsdY = msY - hsdH;
    const isSelf = i===selfIdx;
    const stroke = isSelf ? 'stroke="#1B2A41" stroke-width="2"' : '';
    bars += `<rect x="${x}" y="${msY}" width="${barW}" height="${Math.max(msH,0.5)}" fill="#0054A6" ${stroke}></rect>`;
    bars += `<rect x="${x}" y="${hsdY}" width="${barW}" height="${Math.max(hsdH,0.5)}" fill="#E31E24" ${stroke}></rect>`;
    const msShare = tot>0 ? Math.round(ms/tot*100) : 0;
    bars += `<text class="bar-value-label" x="${x+barW/2}" y="${hsdY-5}" text-anchor="middle">${msShare}/${100-msShare}</text>`;
    const lblY = topPad + chartH + 12;
    const lblX = x + barW/2;
    let label = labels[i].length > 16 ? labels[i].slice(0,15)+'…' : labels[i];
    if(isSelf) label = '★ ' + label;
    bars += `<text class="bar-axis-label${isSelf?' bar-axis-self':''}" x="0" y="0" text-anchor="end" transform="translate(${lblX},${lblY}) rotate(-25)">${escXml(label)}</text>`;
  }
  const baseline = `<line x1="${leftPad}" y1="${topPad+chartH}" x2="${w-leftPad}" y2="${topPad+chartH}" stroke="#DAD4C2" stroke-width="1"></line>`;

  el.innerHTML = `
    ${title ? `<div class="chart-title">${escXml(title)}</div>` : ''}
    <div class="chart-legend"><span><span class="swatch" style="background:#0054A6"></span>MS</span><span><span class="swatch" style="background:#E31E24"></span>HSD</span><span>(labels = MS/HSD % split)</span></div>
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
  searchInput.placeholder = 'Search by RO name, Trading Area, or Location';

  wireEvents();
}
init();

// ---------- select dealer ----------
function selectDealer(d){
  current = d;
  peerSortCol = 'msC'; peerSortDir = -1;
  subGroupField = 'none';
  fuelType = 'ms';
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
  // Combined MS+HSD totals + derived YoY growth
  const sum = (a,b) => (a===null||a===undefined) && (b===null||b===undefined) ? null : (a||0)+(b||0);
  const grow = (c,h) => (c===null||h===null||h===0) ? null : ((c-h)/h)*100;
  const combC = sum(d.msC, d.hsdC),       combH = sum(d.msH, d.hsdH);
  const combCumC = sum(d.msCumC, d.hsdCumC), combCumH = sum(d.msCumH, d.hsdCumH);
  const combPct = grow(combC, combH), combCumPct = grow(combCumC, combCumH);
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
      <div class="odo odo-combined">
        <div class="odo-label">MS+HSD this month</div>
        <div class="odo-val">${fmt(combC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(combPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(combPct)} vs last year</div>
      </div>
      <div class="odo odo-combined">
        <div class="odo-label">MS+HSD cumulative FY</div>
        <div class="odo-val">${fmt(combCumC)}<small>KL</small></div>
        <div class="odo-delta ${pctClass(combCumPct)==='pos'?'delta-pos':'delta-neg'}">${fmtPct(combCumPct)} vs last year</div>
      </div>
    </div>
    <div class="profile-meta">
      <div class="meta-item"><div class="ml">Trading Area</div><div class="mv">${esc(tArea)||'Not mapped'}</div></div>
      <div class="meta-item"><div class="ml">Year Commissioned</div><div class="mv">${esc(d.yearcomm)||'—'}</div></div>
      <div class="meta-item"><div class="ml">Major NH</div><div class="mv">${esc(d.nh)||'—'}</div></div>
      <div class="meta-item"><div class="ml">Dealer Code</div><div class="mv">${esc(d.cn)||'—'}</div></div>
    </div>
  `;
}


function renderHistorical(d){
 const el=document.getElementById('historicalPanel');
 if(!el) return;
 const lbl = fuelLabel();
 el.classList.add('chart-wrap');
 el.innerHTML=`
 <div class="chart-title">${lbl} — Current vs Historical (same period last year)</div>
 <div id="histChart"></div>`;
 renderComparePanels('histChart',{
   panels:[
     {label:'This Month',     cur:fuelVal(d,'c'),    hist:fuelVal(d,'h'),    pct:fuelPct(d,false)},
     {label:'Cumulative FY',  cur:fuelVal(d,'cumC'), hist:fuelVal(d,'cumH'), pct:fuelPct(d,true)},
   ]
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
  const fuels = [
    {k:'ms', l:'MS'},
    {k:'hsd', l:'HSD'},
    {k:'both', l:'MS+HSD'},
  ];

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h3>Trading Area: ${esc(d.tarea)}</h3>
        <div class="sd">Comparing <strong>${esc(d.name)}</strong> against ${group.length} dealer${group.length===1?'':'s'} sharing this trading area in ${esc(d.sa)}.</div>
      </div>
      <div>
        <div class="filter-label" style="color:var(--ink-faint);margin-bottom:4px;">Fuel</div>
        <div class="group-toggle">${fuels.map(f=>`<button class="chip ${f.k===fuelType?'active':''}" data-fuel="${f.k}">${f.l}</button>`).join('')}</div>
      </div>
    </div>
    <div id="peerStats"></div>

    <div class="two-col tc-top">
      <div class="chart-wrap"><div id="shareDonut"></div></div>
      <div id="historicalPanel"></div>
    </div>

    <div class="chart-wrap"><div id="peerChartVol"></div></div>
    <div class="chart-wrap"><div id="growthChart"></div></div>
    <div class="chart-wrap"><div id="mixChart"></div></div>

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

  container.querySelectorAll('[data-fuel]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      fuelType = chip.dataset.fuel;
      renderPeerSection();
    });
  });

  container.querySelectorAll('[data-sf]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      subGroupField = chip.dataset.sf;
      drawSubGroup(group);
    });
  });

  renderHistorical(d);
  drawPeerStatsAndCharts(group);
  drawAnalyticsCharts(group);
  drawPeerTable(group);
  drawSubGroup(group);
}

function drawPeerStatsAndCharts(group){
  const d = current;
  const n = group.length;
  const lbl = fuelLabel();
  const rankOf = (arr, val) => {
    if(val===null||val===undefined) return null;
    const sorted = [...arr].filter(v=>v!==null&&v!==undefined).sort((a,b)=>b-a);
    return sorted.indexOf(val)+1;
  };
  const vals = group.map(x=>fuelVal(x,'c'));
  const valid = vals.filter(v=>v!==null&&v!==undefined);
  const nValid = valid.length;
  const myVal = fuelVal(d,'c');
  const rank = rankOf(vals, myVal);
  const avg = nValid ? valid.reduce((a,b)=>a+b,0)/nValid : null;
  const total = valid.reduce((a,b)=>a+b,0);
  const share = (total>0 && myVal!==null) ? (myVal/total)*100 : null;
  const growth = fuelPct(d, false);
  const vsAvg = (avg!==null && myVal!==null) ? myVal-avg : null;

  document.getElementById('peerStats').innerHTML = `
    <div class="stat-strip stat-strip-5">
      <div class="stat-box"><div class="sl">Peer group size</div><div class="sv">${n} <span class="unit">dealers</span></div></div>
      <div class="stat-box"><div class="sl">${lbl} rank</div><div class="sv">${rank?('#'+rank):'—'} <span class="unit">of ${nValid}</span></div></div>
      <div class="stat-box"><div class="sl">vs group avg</div><div class="sv ${vsAvg>=0?'pos':'neg'}">${vsAvg!==null?((vsAvg>=0?'+':'')+fmt(vsAvg)):'—'} <span class="unit">KL ${lbl}</span></div></div>
      <div class="stat-box"><div class="sl">Area share</div><div class="sv">${share!==null?share.toFixed(1)+'%':'—'} <span class="unit">of ${lbl}</span></div></div>
      <div class="stat-box"><div class="sl">${lbl} YoY growth</div><div class="sv ${pctClass(growth)}">${fmtPct(growth)}</div></div>
    </div>
  `;

  // Peer volume chart for the selected fuel: sort desc, cap to 30, keep selected in view
  const sorted = [...group].sort((a,b)=>(fuelVal(b,'c')??-1)-(fuelVal(a,'c')??-1));
  let shown = sorted;
  if(sorted.length>30){
    const idx = sorted.findIndex(x=>x.id===d.id);
    const start = Math.max(0, Math.min(idx-10, sorted.length-30));
    shown = sorted.slice(start, start+30);
  }
  renderBarChart('peerChartVol', {
    labels: shown.map(x=> x.id===d.id ? '★ '+x.name : x.name),
    values: shown.map(x=>fuelVal(x,'c')),
    colors: shown.map(x=> x.id===d.id ? SELECTED_COLOR : omcColor(x.omc)),
    unitLabel: lbl+' volume (KL)',
    title: lbl+' volume — current month (bars coloured by oil company)',
    legend: omcLegend(shown)
  });
}

// Growth leaderboard + performance quadrant + fuel-mix, all fuel-aware.
function drawAnalyticsCharts(group){
  const d = current;
  const lbl = fuelLabel();

  // ---- Market-share donut + top contributors (selected fuel) ----
  const vals = group.map(x=>fuelVal(x,'c')).filter(v=>v!==null&&v!==undefined);
  const total = vals.reduce((a,b)=>a+b,0);
  const ranked = [...group]
    .filter(x=>fuelVal(x,'c')!==null)
    .sort((a,b)=>fuelVal(b,'c')-fuelVal(a,'c'))
    .map((x,i)=>({ rank:i+1, id:x.id, name:x.name, omc:x.omc, val:fuelVal(x,'c'),
                   share: total>0 ? fuelVal(x,'c')/total*100 : 0, self:x.id===d.id }));
  // top 5, and always include the selected dealer if it's outside the top 5
  let contributors = ranked.slice(0,8);
  if(!contributors.some(c=>c.self)){
    const me = ranked.find(c=>c.self);
    if(me) contributors = [...contributors, {...me, gap:true}];
  }
  renderDonut('shareDonut', {
    value: fuelVal(d,'c'),
    total,
    label: lbl+' market share in '+d.tarea,
    contributors
  });
  // clicking an outlet name in the list jumps to that dealer
  document.getElementById('shareDonut').querySelectorAll('.contrib-name[data-cid]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const dd = DATA.find(x=>x.id===Number(el.dataset.cid));
      if(dd) selectDealer(dd);
    });
  });

  // ---- Growth leaderboard (peers by YoY growth for selected fuel) ----
  const withGrowth = group
    .map(x=>({x, g:fuelPct(x,false)}))
    .filter(o=>o.g!==null && o.g!==undefined && isFinite(o.g))
    .sort((a,b)=>b.g-a.g);
  let lb = withGrowth;
  if(withGrowth.length>30){
    const idx = withGrowth.findIndex(o=>o.x.id===d.id);
    const start = idx<0 ? 0 : Math.max(0, Math.min(idx-10, withGrowth.length-30));
    lb = withGrowth.slice(start, start+30);
  }
  renderGrowthChart('growthChart', {
    labels: lb.map(o=>o.x.name),
    values: lb.map(o=>o.g),
    selfIdx: lb.findIndex(o=>o.x.id===d.id),
    title: lbl+' YoY growth % by dealer (green = growth, red = decline, ★ = selected)'
  });

  // ---- Fuel mix (MS vs HSD) — sorted by combined total, cap 30, keep selected ----
  const mixSorted = [...group].sort((a,b)=>((b.msC||0)+(b.hsdC||0))-((a.msC||0)+(a.hsdC||0)));
  let mix = mixSorted;
  if(mixSorted.length>30){
    const idx = mixSorted.findIndex(x=>x.id===d.id);
    const start = Math.max(0, Math.min(idx-10, mixSorted.length-30));
    mix = mixSorted.slice(start, start+30);
  }
  renderStackedBar('mixChart', {
    labels: mix.map(x=>x.name),
    msVals: mix.map(x=>x.msC),
    hsdVals: mix.map(x=>x.hsdC),
    selfIdx: mix.findIndex(x=>x.id===d.id),
    title: 'Fuel mix — MS vs HSD per dealer (★ = selected)'
  });
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
  const lbl = fuelLabel();
  function avg(arr){ return arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  // avg per outlet for the selected fuel
  const fuelAvg = k => {
    if(fuelType==='ms')  return avg(groups[k].msArr);
    if(fuelType==='hsd') return avg(groups[k].hsdArr);
    return avg(groups[k].msArr) + avg(groups[k].hsdArr); // MS+HSD combined avg
  };

  el.innerHTML = `
    <div class="chart-wrap"><div id="subChartFuel"></div></div>
    <div class="table-scroll"><table class="dtable" id="subTable"></table></div>
  `;

  renderBarChart('subChartFuel', {
    labels: keys,
    values: keys.map(k=>fuelAvg(k)),
    colors: keys.map(k=>k===myKey?'#E31E24':'#0054A6'),
    unitLabel: 'Avg '+lbl+' / outlet (KL)',
    title: 'Avg '+lbl+' per outlet by '+label2(subGroupField)+' — within this trading area (red = selected dealer’s group)'
  });

  const thead = `<thead><tr><th>${label2(subGroupField)}</th><th>Outlets</th><th>Total MS (KL)</th><th>Avg MS (KL)</th><th>Total HSD (KL)</th><th>Avg HSD (KL)</th></tr></thead>`;
  const rows = keys.map(k=>{
    const g = groups[k];
    return `<tr class="${k===myKey?'self-row':''}"><td>${esc(k)}</td><td class="num">${g.n}</td><td class="num">${fmt(g.ms)}</td><td class="num">${fmt(avg(g.msArr))}</td><td class="num">${fmt(g.hsd)}</td><td class="num">${fmt(avg(g.hsdArr))}</td></tr>`;
  }).join('');
  document.getElementById('subTable').innerHTML = thead+'<tbody>'+rows+'</tbody>';
}
