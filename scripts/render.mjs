#!/usr/bin/env node
// Layer 3 · Render. Local store -> ~/.claude/vibe-check/dashboard.html.
// One self-contained file: inline CSS, inline JS, inline SVG, no CDN, no server.
//
//   node render.mjs [--project <name>] [--days <n>]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregate, loadAll } from './lib/aggregate.mjs';
import { store } from './lib/paths.mjs';
import { parseDays, readConfig, readJson, readJsonl, writeText } from './lib/store.mjs';

export function renderHtml(data) {
  // JSON inside <script>: escape "<" so data can never close the tag or open
  // a comment. (U+2028/2029 are legal in JS strings since ES2019.)
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return TEMPLATE.replace('/*__DATA__*/null', json);
}

export function runRender({ project = null, days = 84, now = Date.now() } = {}) {
  const data = aggregate(loadAll(), {
    project,
    days,
    now,
    runs: readJsonl(store.runs()),
    config: readConfig(),
    status: readJson(store.status(), null),
  });
  writeText(store.dashboard(), renderHtml(data));
  return { file: store.dashboard(), data };
}

const TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vibe Check</title>
<style>
:root{
  --page:#f4f4f1; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#6f6d67;
  --grid:#e1e0d9; --axis:#c3c2b7; --ring:rgba(11,11,11,.10); --wash:#efeee9;
  --accent:#1c5cab; --accent-wash:#e3eefc;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100;
  --band:rgba(42,120,214,.12);
  --good:#0ca30c; --good-text:#006300; --warn:#fab219; --warn-text:#8a5a00; --critical:#d03b3b;
  --q0:#cde2fb; --q1:#9ec5f4; --q2:#6da7ec; --q3:#3987e5; --q4:#256abf; --q5:#104281;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#9a988f;
    --grid:#2c2c2a; --axis:#46463f; --ring:rgba(255,255,255,.10); --wash:#232322;
    --accent:#86b6ef; --accent-wash:#16273d;
    --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
    --band:rgba(57,135,229,.18); --good-text:#4cc24c; --warn-text:#fab219;
    --q0:#0d366b; --q1:#184f95; --q2:#1c5cab; --q3:#2a78d6; --q4:#5598e7; --q5:#9ec5f4;
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#9a988f;
  --grid:#2c2c2a; --axis:#46463f; --ring:rgba(255,255,255,.10); --wash:#232322;
  --accent:#86b6ef; --accent-wash:#16273d;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
  --band:rgba(57,135,229,.18); --good-text:#4cc24c; --warn-text:#fab219;
  --q0:#0d366b; --q1:#184f95; --q2:#1c5cab; --q3:#2a78d6; --q4:#5598e7; --q5:#9ec5f4;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 var(--sans);padding-inline:16px}
.wrap{max-width:1120px;margin:0 auto;padding-block:28px 56px;display:grid;gap:20px}
h1,h2{margin:0;text-wrap:balance}
h1{font-size:22px;font-weight:600;letter-spacing:-.01em}
h2{font-size:15px;font-weight:600}
p{margin:0}
.mono{font-family:var(--mono)}
.sub{color:var(--ink-2);font-size:13px}
.eyebrow{font:500 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
header{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;justify-content:space-between}
header .id{display:grid;gap:6px}
.scope{display:flex;flex-wrap:wrap;gap:8px}
.pill{font:500 12px/1 var(--mono);padding:6px 10px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--ring);color:var(--ink-2)}
.banner{background:var(--accent-wash);color:var(--ink);border-radius:8px;padding:12px 16px;font-size:13.5px;display:grid;gap:4px}
.banner.warn{background:color-mix(in srgb,var(--warn) 22%,var(--surface))}
.banner code{font-family:var(--mono);font-size:12.5px}
.legend-prov{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--ink-2);align-items:center}
.prov{font:500 10.5px/1 var(--mono);letter-spacing:.04em;text-transform:uppercase;padding:4px 7px;border-radius:4px;white-space:nowrap}
.prov.m{border:1px solid var(--ink-2);color:var(--ink)}
.prov.e{border:1px dashed var(--ink-2);color:var(--ink-2)}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.tile{background:var(--surface);box-shadow:inset 0 0 0 1px var(--ring);border-radius:8px;padding:16px;display:grid;gap:8px;align-content:start}
.tile .top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tile .v{font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1.05}
.tile .v small{font-size:15px;font-weight:500;color:var(--ink-2);margin-left:2px}
.tile .v.na{color:var(--muted);font-size:26px}
.delta{font-size:12.5px;color:var(--ink-2)}
.delta b{font-weight:600}
.delta b.up{color:var(--good-text)} .delta b.down{color:var(--critical)}
.grid2{display:grid;grid-template-columns:3fr 2fr;gap:12px}
.panel{background:var(--surface);box-shadow:inset 0 0 0 1px var(--ring);border-radius:8px;padding:18px;display:grid;gap:14px;align-content:start;min-width:0}
.panel-h{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline}
.panel-h .t{display:grid;gap:3px}
svg text{font-family:var(--mono);font-size:10.5px;fill:var(--muted)}
svg .lbl{fill:var(--ink-2)}
svg .lbl-strong{fill:var(--ink);font-weight:500}
.chart svg{width:100%;height:auto;display:block}
.empty{color:var(--muted);font-size:13px;padding:24px 0;text-align:center}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--ink-2)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.strips{display:grid;gap:2px}
.strip{display:grid;grid-template-columns:minmax(150px,220px) 1fr 140px;gap:14px;align-items:center;padding:9px 0;border-top:1px solid var(--grid)}
.strip:first-child{border-top:0}
.strip .meta{display:grid;gap:1px;min-width:0}
.strip .meta b{font:500 12.5px/1.3 var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.strip .meta span{font-size:12px;color:var(--ink-2)}
.tagp{font:500 10px/1 var(--mono);color:var(--ink-2);background:var(--wash);padding:2px 5px;border-radius:3px;margin-left:4px;vertical-align:1px}
.track{position:relative;height:26px;background:var(--wash);border-radius:4px}
.track .band{position:absolute;top:0;bottom:0;background:var(--band);border-left:1px dashed var(--s1);border-right:1px dashed var(--s1)}
.mk{position:absolute;top:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--wash)}
.mk.int{width:3px;height:16px;background:var(--s1);border-radius:1px}
.mk.rej{width:9px;height:9px;background:var(--s2);border-radius:1px}
.mk.rew{width:10px;height:10px;background:var(--s3);border-radius:50%}
.mk.cor{width:9px;height:9px;background:var(--s4);transform:translate(-50%,-50%) rotate(45deg)}
.lg .mk{position:static;transform:none;display:inline-block;box-shadow:none}
.lg .mk.cor{transform:rotate(45deg) scale(.85)}
.lg .bandsw{width:16px;height:10px;background:var(--band);border:1px dashed var(--s1);display:inline-block}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;justify-self:start}
.status i{font-style:normal;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:10px;color:#fff;font-weight:700}
.status.ok i{background:var(--good)} .status.ok{color:var(--good-text)}
.status.bad i{background:var(--critical)} .status.bad{color:var(--critical)}
.status.infra i{background:var(--warn);color:#3a2800} .status.infra{color:var(--warn-text)}
.hm-scroll{overflow-x:auto}
.hm{display:grid;grid-template-columns:34px repeat(24,1fr);gap:2px;min-width:520px}
.hm .c{aspect-ratio:1;border-radius:2px}
.hm .c.none{background:transparent;box-shadow:inset 0 0 0 1px var(--grid)}
.hm .rl,.hm .cl{font:10.5px/1 var(--mono);color:var(--muted);display:flex;align-items:center}
.hm .cl{justify-content:center;padding-top:4px}
.ramp{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2);flex-wrap:wrap}
.ramp .cells{display:flex;gap:2px}
.ramp .cells i{width:14px;height:10px;border-radius:2px;display:block}
.stackbar{display:flex;gap:2px;height:22px}
.stackbar div{height:100%}
.stackbar div:first-child{border-radius:4px 0 0 4px}
.stackbar div:last-child{border-radius:0 4px 4px 0}
.hbars{display:grid;gap:10px}
.hbar{display:grid;grid-template-columns:130px 1fr 44px;gap:10px;align-items:center;font-size:12.5px}
.hbar .b{height:14px;background:var(--wash);border-radius:0 4px 4px 0;position:relative}
.hbar .b div{position:absolute;inset:0 auto 0 0;border-radius:0 4px 4px 0}
.hbar .n{font:500 12.5px var(--mono);text-align:right;font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.kv div{background:var(--wash);border-radius:6px;padding:10px 12px;display:grid;gap:2px}
.kv b{font-size:20px;font-weight:600}
.kv span{font-size:12px;color:var(--ink-2)}
.note{font-size:12.5px;color:var(--ink-2);border-left:2px solid var(--axis);padding-left:10px;max-width:68ch}
.tscroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:600px;font-size:13.5px}
th{font:500 10.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);text-align:left;padding:0 10px 10px}
td{padding:11px 10px;border-top:1px solid var(--grid);vertical-align:middle}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
.chip{font:500 11px/1 var(--mono);padding:4px 7px;border-radius:4px;white-space:nowrap}
.chip.no{background:var(--wash);color:var(--ink-2)}
.chip.ignored{background:var(--warn);color:#3a2800}
button{font:500 12.5px var(--sans);color:var(--accent);background:transparent;border:1px solid currentColor;border-radius:6px;padding:6px 10px;cursor:pointer;white-space:nowrap}
button:hover{background:var(--accent-wash)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
details summary{cursor:pointer;font-size:12.5px;color:var(--accent)}
details[open] summary{margin-bottom:8px}
.weights{display:flex;flex-wrap:wrap;gap:6px}
.weights span{font:12px var(--mono);background:var(--wash);padding:4px 8px;border-radius:4px}
.weights span.off{opacity:.5;text-decoration:line-through}
.tip{position:fixed;z-index:10;pointer-events:none;background:var(--ink);color:var(--surface);font:12px/1.4 var(--sans);padding:7px 9px;border-radius:6px;max-width:260px;opacity:0}
.tip b{font-family:var(--mono);font-weight:500}
footer{font-size:12px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:6px 18px}
@media (max-width:900px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.grid2{grid-template-columns:1fr}}
@media (max-width:560px){.strip{grid-template-columns:1fr;gap:6px}.tile .v{font-size:28px}.hbar{grid-template-columns:100px 1fr 40px}.tiles{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap" id="app"></div>
<div class="tip" id="tip" role="tooltip"></div>
<script>
const D = /*__DATA__*/null;
(function(){
'use strict';
const NS='http://www.w3.org/2000/svg';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=1)=>n==null?'—':(Math.round(n*10**d)/10**d).toLocaleString();
function h(tag,attrs,html){const e=document.createElement(tag);for(const k in attrs||{})e.setAttribute(k,attrs[k]);if(html!=null)e.innerHTML=html;return e;}
function s(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,str,cls,anchor){const t=s('text',{x,y,'text-anchor':anchor||'start'},parent);if(cls)t.setAttribute('class',cls);t.textContent=str;return t;}
const M='<span class="prov m">Measured</span>', E='<span class="prov e">Estimated</span>';
const app=document.getElementById('app');
const est=D.estimates;
const hasLabels=est.labelled>0;
const dateTime=ts=>{const d=new Date(ts);return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};

function panel(title,sub,prov,cls){const p=h('section',{class:'panel'+(cls?' '+cls:'')});p.appendChild(h('div',{class:'panel-h'},'<div class="t"><h2>'+esc(title)+'</h2>'+(sub?'<p class="sub">'+sub+'</p>':'')+'</div>'+prov));return p;}

/* header */
const hd=h('header');
hd.appendChild(h('div',{class:'id'},'<span class="eyebrow">/vibe-check</span><h1>You and Claude, last '+Math.round(D.scope.days/7)+' weeks</h1><p class="sub mono">'+D.totals.sessions.toLocaleString()+' sessions · '+D.totals.typed.toLocaleString()+' typed prompts · '+D.totals.subagentRuns+' subagent runs · generated '+esc(dateTime(D.generatedAt))+'</p>'));
hd.appendChild(h('div',{class:'scope'},'<span class="pill">'+esc(D.scope.project||'All projects')+'</span><span class="pill">'+esc(D.scope.fromLabel)+' – '+esc(D.scope.toLabel)+'</span>'));
app.appendChild(hd);

/* banners: freshness, auto-classify, self-test */
const st=D.status;
if(st&&st.running){app.appendChild(h('div',{class:'banner'},'<b>Classifying in the background</b><span>'+st.done+' of '+st.total+' sessions done. Reopen this page when it finishes.</span>'));}
if(D.auto.selftest&&D.auto.selftest.ok===false){app.appendChild(h('div',{class:'banner warn'},'<b>Auto-classify is off: the isolation self-test failed</b><span>'+esc(D.auto.selftest.reason||'')+' (Claude Code '+esc(D.auto.selftest.ccVersion||'?')+'). Manual <code>/vibe-check</code> still works.</span>'));}
if(!D.totals.sessions){app.appendChild(h('div',{class:'banner'},'<b>No sessions yet</b><span>Metrics appear after your first Claude Code session ends. Run <code>/vibe-check</code> to scan existing transcripts.</span>'));}
else if(!hasLabels){app.appendChild(h('div',{class:'banner'},'<b>Estimated panels are empty</b><span>'+est.pending+' prompts are waiting to be classified. Run <code>/vibe-check</code> to classify them in the background (about $0.007 per session), or turn on <code>/vibe-check --auto on</code>.</span>'));}
else if(est.pending>0){app.appendChild(h('div',{class:'banner'},'<span><b>'+est.pending+'</b> of '+est.eligible+' prompts not classified yet. Estimates last refreshed '+esc(est.lastClassified?dateTime(est.lastClassified):'never')+'.</span>'));}
if(D.spend.warnHighOutput){app.appendChild(h('div',{class:'banner warn'},'<b>Classification cost per call has gone up</b><span>Recent calls average '+D.spend.avgOutputTokens+' output tokens (expected under 2,000). Model thinking may have been switched back on by a Claude Code update.</span>'));}

app.appendChild(h('div',{class:'legend-prov'},'<span>'+M+' counted by the script from transcript events</span><span>'+E+' classified by Haiku from your prompts'+(est.unsure?', '+est.unsure+' marked unsure':'')+'</span>'));

/* tiles */
const T=D.tiles, tiles=h('section',{class:'tiles','aria-label':'Summary'});
function tile(name,prov,val,unit,delta){const v=val==null?'<div class="v na">—</div>':'<div class="v">'+val+'<small>'+unit+'</small></div>';tiles.appendChild(h('div',{class:'tile'},'<div class="top"><span class="eyebrow">'+name+'</span>'+prov+'</div>'+v+'<p class="delta">'+delta+'</p>'));}
const arrow=(d,goodUp)=>d==null?'':'<b class="'+((d>0)===goodUp?'up':'down')+'">'+(d>0?'▲ ':'▼ ')+fmt(Math.abs(d))+'</b> ';
tile('Vibe score',T.vibe&&T.vibe.partial?'<span class="prov e">Partial</span>':E,T.vibe?T.vibe.value:null,'/100',T.vibe?(T.vibe.delta!=null?arrow(T.vibe.delta,true)+'vs week of '+esc(T.vibe.since):(T.vibe.partial?'From measured signals only until prompts are classified':'')):'Needs a week with 5+ prompts');
tile('First-try acceptance',E,T.firstTry,'%',T.firstTry==null?'Needs classified prompts':'Requests with no correction before moving on');
tile('Interrupts',M,T.interrupts.per100==null?null:fmt(T.interrupts.per100),'/100 prompts',T.interrupts.delta!=null?arrow(T.interrupts.delta,false)+'since '+esc(T.interrupts.since):'');
tile('Gave up',E,hasLabels?T.gaveUp.sessions:null,' sessions',hasLabels?(T.gaveUp.late?T.gaveUp.late+' of them after 22:00':'Sessions ending in a give-up'):'Needs classified prompts');
app.appendChild(tiles);

/* vibe score by week */
(function(){
  const p=panel('Vibe score by week','Dashed lines mark model and Claude Code version changes.',hasLabels?E:'<span class="prov e">Partial</span>');
  const c=h('div',{class:'chart'});p.appendChild(c);
  const W=D.weeks, pts=W.map((w,i)=>[i,w.score]).filter(x=>x[1]!=null);
  if(pts.length<1){c.appendChild(h('p',{class:'empty'},'Not enough data yet. A week needs at least 5 typed prompts.'));}
  else{
    const Wd=720,H=230,m={l:34,r:24,t:24,b:26},iw=Wd-m.l-m.r,ih=H-m.t-m.b,n=Math.max(2,W.length);
    const vals=pts.map(x=>x[1]);let y0=Math.max(0,Math.floor((Math.min(...vals)-8)/10)*10),y1=Math.min(100,Math.ceil((Math.max(...vals)+8)/10)*10);if(y1-y0<20){y0=Math.max(0,y1-20);}
    const x=i=>m.l+i*iw/(n-1),y=v=>m.t+ih-(v-y0)/(y1-y0)*ih;
    const svg=s('svg',{viewBox:'0 0 '+Wd+' '+H,role:'img','aria-label':'Weekly vibe score'});
    for(let v=y0;v<=y1;v+=10){s('line',{x1:m.l,x2:Wd-m.r,y1:y(v),y2:y(v),stroke:'var(--grid)'},svg);txt(svg,m.l-8,y(v)+3.5,v,null,'end');}
    const step=Math.max(1,Math.ceil(W.length/7));
    W.forEach((w,i)=>{if(i%step===0||i===W.length-1)txt(svg,x(i),H-6,w.label,null,i===0?'start':i===W.length-1?'end':'middle');});
    D.marks.forEach(mk=>{s('line',{x1:x(mk.i),x2:x(mk.i),y1:m.t-4,y2:m.t+ih,stroke:'var(--axis)','stroke-dasharray':'3 3'},svg);txt(svg,x(mk.i)+5,m.t+6,mk.label,'lbl');});
    const P=pts.map(([i,v])=>[x(i),y(v)]);
    if(P.length>1)s('path',{d:'M'+P.map(p=>p.join(',')).join('L'),fill:'none',stroke:'var(--s1)','stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
    pts.forEach(([i,v],k)=>{const last=k===pts.length-1;const dot=s('circle',{cx:x(i),cy:y(v),r:last?5:3,fill:'var(--s1)',stroke:'var(--surface)','stroke-width':2},svg);});
    const L=pts[pts.length-1];txt(svg,x(L[0])-8,y(L[1])-10,L[1],'lbl-strong','end');
    W.forEach((w,i)=>{const r=s('rect',{x:x(i)-iw/(n-1)/2,y:m.t,width:iw/(n-1),height:ih,fill:'transparent'},svg);r.dataset.tip='Week of <b>'+esc(w.label)+'</b><br>'+(w.score==null?'Too few prompts ('+w.prompts+')':'Score <b>'+w.score+'</b>'+(w.partial?' (partial)':'')+'<br>'+w.prompts+' prompts, '+w.labelled+' classified');});
    c.appendChild(svg);
  }
  const d=h('details');d.appendChild(h('summary',{},'How the score is weighted'));
  d.appendChild(h('div',{class:'weights'},D.score.weights.map(w=>'<span class="'+(D.score.used.includes(w.key)?'':'off')+'">'+esc(w.label)+' '+w.weight+'%</span>').join('')));
  d.appendChild(h('p',{class:'note',style:'margin-top:8px'},'Each signal is a rate per 100 prompts (or share of sessions for gave up), capped, then weighted. Signals not yet available are left out and the rest re-weighted. API errors, auth expiries and retries are excluded. This period: '+D.totals.apiErrors+' API errors, '+D.totals.retries+' retries, '+D.totals.authErrors+' auth errors.'));
  p.appendChild(d);app.appendChild(p);
})();

const g1=h('div',{class:'grid2'});app.appendChild(g1);

/* friction stacked bars */
(function(){
  const p=panel('Friction per 100 prompts','Stacked by type, weekly.',M);
  const series=[{k:'interrupts',n:'Interrupts',c:'var(--s1)'},{k:'rejections',n:'Tool rejections',c:'var(--s2)'},{k:'rewinds',n:'Rewinds',c:'var(--s3)'}];
  if(hasLabels)series.push({k:'corrections',n:'Action corrections',c:'var(--s4)',est:true});
  p.appendChild(h('div',{class:'legend'},series.map(se=>'<span><i class="sw" style="background:'+se.c+'"></i>'+se.n+(se.est?' <span class="prov e">Est.</span>':'')+'</span>').join('')));
  const c=h('div',{class:'chart'});p.appendChild(c);
  const W=D.weeks;
  if(!W.some(w=>w.prompts)){c.appendChild(h('p',{class:'empty'},'No prompts in this period.'));g1.appendChild(p);return;}
  const tot=W.map(w=>series.reduce((a,se)=>a+(w[se.k]||0),0));
  const max=Math.max(4,Math.ceil(Math.max(...tot)/4)*4);
  const Wd=520,H=240,m={l:28,r:8,t:10,b:26},iw=Wd-m.l-m.r,ih=H-m.t-m.b,band=iw/W.length,bw=band*0.62,y=v=>v/max*ih;
  const svg=s('svg',{viewBox:'0 0 '+Wd+' '+H,role:'img','aria-label':'Weekly friction per 100 prompts'});
  for(let v=0;v<=max;v+=max/4){s('line',{x1:m.l,x2:Wd-m.r,y1:m.t+ih-y(v),y2:m.t+ih-y(v),stroke:v?'var(--grid)':'var(--axis)'},svg);txt(svg,m.l-6,m.t+ih-y(v)+3.5,fmt(v,0),null,'end');}
  const step=Math.max(1,Math.ceil(W.length/5));
  W.forEach((w,i)=>{
    const x0=m.l+i*band+(band-bw)/2;let acc=0;
    if(w.prompts)series.forEach(se=>{const v=w[se.k]||0;if(!v)return;const hh=y(v);s('rect',{x:x0,y:m.t+ih-y(acc)-hh+1,width:bw,height:Math.max(0,hh-1),fill:se.c},svg);acc+=v;});
    if(i%step===0||i===W.length-1)txt(svg,x0+bw/2,H-6,w.label,null,'middle');
    const hit=s('rect',{x:m.l+i*band,y:m.t,width:band,height:ih,fill:'transparent'},svg);
    hit.dataset.tip='Week of <b>'+esc(w.label)+'</b> · '+w.prompts+' prompts<br>'+series.map(se=>se.n+' <b>'+fmt(w[se.k])+'</b>').join('<br>');
  });
  c.appendChild(svg);g1.appendChild(p);
})();

/* heatmap */
(function(){
  const p=panel('When friction happens','Share of prompts with an interrupt, rejection or rewind, by hour.',M);
  const sc=h('div',{class:'hm-scroll'}),root=h('div',{class:'hm'});sc.appendChild(root);p.appendChild(sc);
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const add=(cls,t)=>{const d=h('div',{class:cls});if(t!=null)d.textContent=t;root.appendChild(d);return d;};
  days.forEach((d,di)=>{add('rl',d);for(let hr=0;hr<24;hr++){const cell=D.heat[di][hr];const hh=String(hr).padStart(2,'0');
    if(!cell.p){add('c none').dataset.tip=d+' '+hh+':00 · no prompts';continue;}
    const r=Math.round(cell.f/cell.p*100),q=Math.min(5,Math.floor(r/6));const c=add('c');c.style.background='var(--q'+q+')';
    c.dataset.tip=d+' '+hh+':00 · <b>'+r+'%</b> of '+cell.p+' prompts had friction';}});
  add('rl','');for(let hr=0;hr<24;hr++)add('cl',hr%6===0?String(hr).padStart(2,'0'):'');
  p.appendChild(h('div',{class:'ramp'},'0%<span class="cells">'+[0,1,2,3,4,5].map(q=>'<i style="background:var(--q'+q+')"></i>').join('')+'</span>30%+ <span style="margin-left:10px;display:inline-flex;gap:6px;align-items:center"><i class="sw" style="box-shadow:inset 0 0 0 1px var(--grid)"></i>no prompts</span>'));
  g1.appendChild(p);
})();

/* session strips */
(function(){
  const p=panel('Recent sessions','Each bar is one session from first prompt to last activity. Shaded spans are subagent runs.','<div class="legend lg"><span><i class="mk int"></i>Interrupt</span><span><i class="mk rej"></i>Tool rejection</span><span><i class="mk rew"></i>Rewind</span><span><i class="mk cor"></i>Correction</span><span><i class="bandsw"></i>Subagent</span></div>');
  const root=h('div',{class:'strips'});p.appendChild(root);
  if(!D.strips.length)root.appendChild(h('p',{class:'empty'},'No sessions in this period.'));
  const names={int:'Interrupt',rej:'Tool rejection',rew:'Rewind',cor:'Correction'},icon={ok:'✓',bad:'✕',infra:'!'};
  D.strips.forEach(x=>{
    const row=h('div',{class:'strip'});
    row.appendChild(h('div',{class:'meta'},'<b title="'+esc(x.title||'')+'">'+esc(x.project)+(x.pending?'<span class="tagp">unclassified</span>':'')+'</b><span class="mono">'+esc(x.id)+' · '+esc(x.when)+' · '+esc(x.dur)+' · '+x.n+' prompts</span>'));
    const tr=h('div',{class:'track'});
    x.bands.forEach(b=>{const d=h('div',{class:'band'});d.style.left=b[0]*100+'%';d.style.width=Math.max(.5,(b[1]-b[0])*100)+'%';d.dataset.tip='Subagent running';tr.appendChild(d);});
    x.events.forEach(e=>{const d=h('i',{class:'mk '+e[1]});d.style.left=e[0]*100+'%';d.dataset.tip=names[e[1]]+' · '+Math.round(e[0]*x.durMin)+' min in';tr.appendChild(d);});
    if(!x.events.length)tr.dataset.tip='No friction recorded';
    row.appendChild(tr);
    row.appendChild(h('span',{class:'status '+x.out},'<i aria-hidden="true">'+icon[x.out]+'</i>'+esc(x.outTxt)));
    root.appendChild(row);
  });
  app.appendChild(p);
})();

const g2=h('div',{class:'grid2'});app.appendChild(g2);

/* delegation */
(function(){
  const d=D.delegation,p=panel('Delegation to subagents','Friction on turns where Claude used a subagent, compared with turns it handled directly.',M);
  if(!d.runs){p.appendChild(h('p',{class:'empty'},'No subagent runs in this period.'));g2.appendChild(p);return;}
  const mx=Math.max(1,d.directPer100||0,d.delegatedPer100||0);
  p.appendChild(h('div',{class:'hbars'},'<div class="hbar"><span>Direct turns</span><div class="b"><div style="width:'+((d.directPer100||0)/mx*90)+'%;background:var(--ink-2)"></div></div><span class="n">'+fmt(d.directPer100)+'</span></div><div class="hbar"><span>Delegated turns</span><div class="b"><div style="width:'+((d.delegatedPer100||0)/mx*90)+'%;background:var(--ink)"></div></div><span class="n">'+fmt(d.delegatedPer100)+'</span></div>'));
  p.appendChild(h('p',{class:'sub'},'Friction events per 100 prompts.'));
  p.appendChild(h('div',{class:'kv'},'<div><b>'+(d.share==null?'—':d.share+'%')+'</b><span>of turns used a subagent</span></div><div><b>'+(d.sidechainErrorRate==null?(d.runErrorRate==null?'—':d.runErrorRate+'%'):d.sidechainErrorRate+'%')+'</b><span>'+(d.sidechainErrorRate==null?'subagent runs failed':'subagent tool calls errored')+'</span></div>'));
  g2.appendChild(p);
})();

/* challenges */
(function(){
  const c=D.challenges;
  const p=panel('When you challenged Claude',c?c.total+' times you questioned a claim. How Claude responded:':'How Claude responds when you question a claim.',E);
  if(!c){p.appendChild(h('p',{class:'empty'},hasLabels?'No challenged claims in this period.':'Needs classified prompts.'));g2.appendChild(p);return;}
  const parts=[['revised-with-reason','Revised with a reason','var(--s1)'],['defended','Held its position','var(--s2)'],['flipped-without-reason','Flipped without a reason','var(--s3)']];
  const known=parts.reduce((a,x)=>a+c[x[0]],0)||1;
  const bar=h('div',{class:'stackbar',role:'img'});
  parts.forEach(x=>{if(!c[x[0]])return;const pc=Math.round(c[x[0]]/known*100);const d=h('div');d.style.width=pc+'%';d.style.background=x[2];d.dataset.tip='<b>'+c[x[0]]+'</b> '+x[1].toLowerCase()+' ('+pc+'%)';bar.appendChild(d);});
  p.appendChild(bar);
  p.appendChild(h('div',{class:'legend'},parts.map(x=>'<span><i class="sw" style="background:'+x[2]+'"></i>'+x[1]+' · '+Math.round(c[x[0]]/known*100)+'%</span>').join('')));
  p.appendChild(h('p',{class:'note'},'Flipping without a new argument is a sign of sycophancy. Watch whether this share rises.'));
  g2.appendChild(p);
})();

/* repeated corrections */
(function(){
  const p=panel('Corrections you keep repeating','Grouped across sessions. Each one is a candidate rule for CLAUDE.md.',E);
  if(!D.rules.length){p.appendChild(h('p',{class:'empty'},hasLabels?'No correction repeated twice yet.':'Needs classified prompts.'));app.appendChild(p);return;}
  const wrap=h('div',{class:'tscroll'}),tb=h('tbody');
  const tbl=h('table',{},'<thead><tr><th>Correction</th><th class="num">Times</th><th class="num">Sessions</th><th>Last seen</th><th>CLAUDE.md</th><th></th></tr></thead>');
  tbl.appendChild(tb);wrap.appendChild(tbl);p.appendChild(wrap);
  D.rules.forEach(r=>{
    const tr=h('tr');
    const td1=h('td');td1.textContent=r.text;tr.appendChild(td1);
    tr.appendChild(h('td',{class:'num'},String(r.times)));tr.appendChild(h('td',{class:'num'},String(r.sessions)));
    const td4=h('td',{class:'mono'});td4.textContent=r.last;tr.appendChild(td4);
    tr.appendChild(h('td',{},r.inClaudeMd?'<span class="chip ignored">In file, still repeated</span>':'<span class="chip no">Not yet</span>'));
    const td6=h('td'),b=h('button',{type:'button'},'Copy rule');td6.appendChild(b);tr.appendChild(td6);
    b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('- '+r.text);b.textContent='Copied';}catch(e){b.textContent='Copy failed';}setTimeout(()=>b.textContent='Copy rule',1600);});
    tb.appendChild(tr);
  });
  app.appendChild(p);
})();

/* footer */
app.appendChild(h('footer',{},'<span>Local only. Only the prompts you choose to classify are sent to your model provider.</span><span class="mono">~/.claude/vibe-check/dashboard.html</span><span>Behavior refreshes on every SessionEnd. Estimates refresh when you run /vibe-check'+(D.auto.on?' and after each session (auto-classify on)':'')+'.</span>'+(D.spend.calls?'<span>Classification this period: '+D.spend.calls+' calls, $'+D.spend.costUsd.toFixed(3)+'</span>':'')+(est.models.length?'<span>Labels by '+esc(est.models.join(', '))+'</span>':'')));

/* tooltip */
const tip=document.getElementById('tip');
document.addEventListener('mousemove',e=>{
  const t=e.target.closest&&e.target.closest('[data-tip]');
  if(!t){tip.style.opacity=0;return;}
  tip.innerHTML=t.dataset.tip;tip.style.opacity=1;
  const w=tip.offsetWidth,hh=tip.offsetHeight;let x=e.clientX+14,y=e.clientY+14;
  if(x+w>innerWidth-8)x=e.clientX-w-14;if(y+hh>innerHeight-8)y=e.clientY-hh-14;
  tip.style.left=x+'px';tip.style.top=y+'px';
});
})();
</script>
</body>
</html>
`;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const { file } = runRender({ project: val('--project'), days: parseDays(val('--days')) });
  console.log(`Dashboard: ${file}`);
}
