// 현황 · 보고서 · 순마진 화면 — 담당자와 보기 전용이 같은 화면을 씁니다.
import { BIZ, dayModel, sumModels, statusOf, pct, won } from './report.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const TINT = { 그로븐: '#EEF3FD', 옐로우브릿지: '#F4EFFC' };
const BARC = { 그로븐: '#A9C1EE', 옐로우브릿지: '#CDB8EC' };

export function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const dow = (d) => DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
const md = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const monthStart = (d) => d.slice(0, 8) + '01';
function monthEnd(d) {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const out = [];
  for (let d = a; d <= b; d = shift(d, 1)) out.push(d);
  return out;
}

// ── 데이터: 월 단위로 받아 두고 재사용 ─────────────────────
let db = null;
const months = new Map(); // 'yyyy-mm' → { snaps: Map(date→row), phone: Map(date→rows[]) }

async function loadMonth(ym) {
  if (months.has(ym)) return months.get(ym);
  const from = ym + '-01', to = monthEnd(from);
  const [{ data: snaps }, { data: phone }] = await Promise.all([
    db.from('report_snapshots').select('report_date, status, data, updated_at').gte('report_date', from).lte('report_date', to),
    db.from('b2b_sales').select('sale_date, business, item, qty, sales, buy').eq('source', 'phone').is('deleted_at', null).gte('sale_date', from).lte('sale_date', to),
  ]);
  const entry = { snaps: new Map((snaps || []).map((r) => [r.report_date, r])), phone: new Map() };
  for (const r of phone || []) {
    if (!entry.phone.has(r.sale_date)) entry.phone.set(r.sale_date, []);
    entry.phone.get(r.sale_date).push(r);
  }
  months.set(ym, entry);
  return entry;
}
async function ensure(from, to) {
  const yms = new Set(daysBetween(from, to).map((d) => d.slice(0, 7)));
  await Promise.all([...yms].map(loadMonth));
}
const snapOf = (d) => months.get(d.slice(0, 7))?.snaps.get(d) || null;
const phoneOf = (d) => months.get(d.slice(0, 7))?.phone.get(d) || [];
const modelOf = (d) => dayModel(snapOf(d), phoneOf(d));
export function invalidate(date) {
  if (date) months.delete(String(date).slice(0, 7)); else months.clear();
}

// ── 공통 조각 ─────────────────────────────────────────────
const state = { home: '오늘', mode: 'day', day: kstToday(), role: 'viewer', go: () => {} };

function seg(el, items, cur, on) {
  el.innerHTML = items.map(([k, label]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === cur}">${esc(label)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => on(b.dataset.k); });
}

function summaryCard(m, extra = '') {
  const gS = m.biz.그로븐.sales, yS = m.biz.옐로우브릿지.sales, t = gS + yS || 1;
  return `<div class="card" style="gap:10px">
    <div class="row" style="align-items:flex-end">
      <div><div class="meta">총 매출 · ${won(m.count)}건</div><div class="big">${won(m.sales)}원</div></div>
      <div style="text-align:right"><div class="meta green">순이익 ${pct(m.profit, m.sales)}</div><div class="amt green" style="font-size:18px">${won(m.profit)}원</div></div>
    </div>${extra}
    <div class="bar" style="height:10px"><i style="width:${gS / t * 100}%;background:${BARC.그로븐}"></i><i style="width:${yS / t * 100}%;background:${BARC.옐로우브릿지}"></i></div>
    <div class="row meta" style="color:var(--ink2)"><span>그로븐 ${pct(gS, t)}</span><span>자사 ${pct(m.own, m.sales)} · B2B ${pct(m.b2b, m.sales)}</span><span>옐로우브릿지 ${pct(yS, t)}</span></div>
  </div>`;
}

function chart(days, onPick) {
  const vals = days.map((d) => ({ d, m: modelOf(d) }));
  const max = Math.max(1, ...vals.map((v) => v.m.sales));
  const html = `<div class="chart">${vals.map(({ d, m }, i) => {
    const h = Math.round(m.sales / max * 80);
    const p = m.sales ? Math.max(0, Math.round(m.profit / m.sales * 100)) : 0;
    const label = days.length > 10 ? ((+d.slice(8) % 5 === 1 || i === days.length - 1) ? +d.slice(8) : '') : `${+d.slice(8)}일`;
    return `<button type="button" data-d="${d}" aria-label="${md(d)} 보고서"><div class="col" style="height:${h}px"><i style="height:${p}%"></i></div><small>${label}</small></button>`;
  }).join('')}</div>
  <div class="row meta" style="justify-content:flex-start;gap:12px"><span><span class="dot" style="background:#C9D7F5;border-radius:2px"></span> 매출</span><span><span class="dot" style="background:#5B7FD0;border-radius:2px"></span> 순이익</span></div>`;
  return { html, bind: (root) => root.querySelectorAll('.chart button').forEach((b) => { b.onclick = () => onPick(b.dataset.d); }) };
}

// ── 현황 ──────────────────────────────────────────────────
export async function renderHome() {
  const today = kstToday();
  seg($('homeSeg'), [['오늘', '오늘'], ['이번 주', '이번 주'], ['이번 달', '이번 달']], state.home, (k) => { state.home = k; renderHome(); });
  const range = state.home === '이번 달' ? daysBetween(monthStart(today), today) : daysBetween(shift(today, -6), today);
  await ensure(range[0], today);
  const m = state.home === '오늘' ? modelOf(today) : sumModels(range.map(modelOf));
  $('homeSub').textContent = state.home === '오늘' ? `${md(today)} (${dow(today)}) · 지금까지`
    : `${md(range[0])} ~ ${md(today)}`;
  const st = range.map((d) => statusOf(snapOf(d), d, today));
  const status = state.home === '오늘'
    ? (st[st.length - 1] === 'done' ? ['done', '마감 확정'] : ['live', '진행 중 · 마감 전 숫자입니다'])
    : ['done', `${st.filter((s) => s === 'done').length}일 확정 · ${st.filter((s) => s === 'check').length}일 확인 중 · 오늘 진행 중`];
  const gS = m.biz.그로븐.sales, yS = m.biz.옐로우브릿지.sales, t = gS + yS || 1;
  const days = state.home === '오늘' ? daysBetween(shift(today, -6), today) : range;
  const c = chart(days, (d) => { state.mode = 'day'; state.day = d; state.go('report'); });
  let rows;
  if (state.home === '이번 달') {
    const weeks = [];
    let cur = [];
    for (const d of range) { cur.push(d); if (dow(d) === '일') { weeks.push(cur); cur = []; } }
    if (cur.length) weeks.push(cur);
    rows = weeks.map((w, i) => { const s = sumModels(w.map(modelOf)); return [`${i + 1}주 (${+w[0].slice(8)}~${+w[w.length - 1].slice(8)}일)`, s.sales, s.profit, false]; });
  } else {
    rows = days.slice().reverse().map((d) => { const s = modelOf(d); return [`${+d.slice(5, 7)}/${+d.slice(8)} (${dow(d)})${d === today ? ' 진행 중' : ''}`, s.sales, s.profit, d === today]; });
  }
  $('homeMain').innerHTML = `
    <div class="card" style="gap:10px">
      <div class="row" style="align-items:flex-end">
        <div><div class="meta">총 매출 · ${won(m.count)}건</div><div class="big">${won(m.sales)}원</div></div>
        <div style="text-align:right"><div class="meta green">순이익 ${pct(m.profit, m.sales)}</div><div class="amt green" style="font-size:17px">${won(m.profit)}원</div></div>
      </div>
      <span class="pill ${status[0]}">${esc(status[1])}</span>
    </div>
    <div class="card" style="gap:10px"><b>사업자별 매출</b>
      ${BIZ.map((b) => `<div><div class="row" style="font-size:13px"><span>${b} <span class="meta">${pct(m.biz[b].sales, t)}</span></span><b>${won(m.biz[b].sales)}원</b></div>
        <div class="bar" style="margin-top:4px"><i style="width:${m.biz[b].sales / t * 100}%;background:${BARC[b]}"></i></div></div>`).join('')}
    </div>
    <div class="card"><b>${state.home === '이번 달' ? '이번 달 일별 매출 · 순이익' : '최근 7일 매출 · 순이익'}</b>${c.html}
      <div class="tbl h" style="grid-template-columns:1fr 1.2fr 1fr"><span>${state.home === '이번 달' ? '주차' : '날짜'}</span><span class="r">매출</span><span class="r">순이익</span></div>
      ${rows.map(([l, s, p, strong]) => `<div class="tbl" style="grid-template-columns:1fr 1.2fr 1fr;${strong ? 'font-weight:700' : ''}"><span>${esc(l)}</span><span class="r">${won(s)}원</span><span class="r green">${won(p)}원</span></div>`).join('')}
    </div>
    <button class="btn" type="button" id="toReport">보고서 보기 (일일 · 이번 달)</button>`;
  c.bind($('homeMain'));
  $('toReport').onclick = () => state.go('report');
}

// ── 보고서 ────────────────────────────────────────────────
function bizCard(name, b) {
  const chans = Object.values(b.channels).sort((a, c) => (a.type === c.type ? c.sales - a.sales : a.type === '자사' ? -1 : 1));
  const plats = Object.entries(b.plats).map(([p, v]) => `${esc(p)} ${won(v.count)}건 ${won(v.sales)}`).join(' · ');
  return `<div class="card">
    <div class="bizhead" style="background:${TINT[name]}">
      <b style="font-size:16px">${name}</b>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        <div><div class="meta">매출 · ${won(b.count)}건</div><b>${won(b.sales)}</b></div>
        <div><div class="meta">매입</div><b>${won(b.purchase)}</b></div>
        <div style="text-align:right"><div class="meta green">순이익 ${pct(b.profit, b.sales)}</div><b class="green">${won(b.profit)}</b></div>
      </div>
    </div>
    ${chans.length ? chans.map((c) => `<details>
      <summary>
        <div class="row"><span style="display:flex;gap:6px;align-items:center"><span class="lowtag" style="${c.type === 'B2B' ? 'background:var(--warnT);color:var(--warn)' : 'background:var(--accentT);color:var(--accentD)'}">${c.type}</span><b style="font-size:14px;font-weight:500">${esc(c.name)}</b></span><span class="chev">›</span></div>
        <div class="row meta"><span>${won(c.count)}건 · 매출 <b style="color:var(--ink)">${won(c.sales)}</b></span><span>순이익 <b class="green">${won(c.profit)}</b> (${pct(c.profit, c.sales)})</span></div>
      </summary>
      ${c.type === '자사' && plats ? `<div class="meta" style="padding-bottom:4px">${plats}</div>` : ''}
      <div class="tbl h" style="grid-template-columns:1.6fr .5fr 1fr 1fr"><span>품목</span><span class="r">건</span><span class="r">매출</span><span class="r">순이익</span></div>
      ${Object.values(c.items).sort((a, d) => d.sales - a.sales).map((it) => `<div class="tbl" style="grid-template-columns:1.6fr .5fr 1fr 1fr"><span>${esc(it.name)}</span><span class="r">${won(it.count)}</span><span class="r">${won(it.sales)}</span><b class="r green">${won(it.profit)}</b></div>`).join('')}
    </details>`).join('') : '<div class="meta" style="padding:10px 0">이 기간 매출이 없습니다</div>'}
  </div>`;
}

function flowCard(m) {
  const rows = [['총 매출', m.sales, ''], ['− 매입', m.purchase, pct(m.purchase, m.sales)], ['− 판매수수료', m.fee, pct(m.fee, m.sales)], ['− 납부 부가세', m.vat, ''], ['− 광고비', m.ad, pct(m.ad, m.sales)]];
  return `<div class="card"><b>매출에서 순이익까지</b>
    ${rows.map(([l, v, p], i) => `<div class="tbl" style="grid-template-columns:1fr auto auto;gap:8px"><span>${l}</span><span class="meta">${p}</span><span class="r" style="${i ? '' : 'font-weight:700'}">${won(v)}</span></div>`).join('')}
    <div class="tbl" style="grid-template-columns:1fr auto auto;gap:8px;border-top:1.5px solid #D1D5DB"><span>= 순이익</span><span class="meta">${pct(m.profit, m.sales)}</span><b class="r green" style="font-size:16px">${won(m.profit)}</b></div>
  </div>`;
}

function topCard(m) {
  const items = [];
  for (const b of BIZ) for (const c of Object.values(m.biz[b].channels)) for (const it of Object.values(c.items)) items.push(it);
  const top = items.sort((a, b) => b.profit - a.profit).slice(0, 5);
  const max = Math.max(1, top[0]?.profit || 1);
  return `<div class="card"><div class="row"><b>상품별 순이익 TOP 5</b><button class="chip" type="button" id="toMargin">전체 순마진 ›</button></div>
    ${top.map((t, i) => `<div style="padding:4px 0"><div class="row" style="font-size:12px"><span>${i + 1}. ${esc(t.name)} <span class="meta">${won(t.count)}건 · 매출 ${won(t.sales)}</span></span><b class="green">${won(t.profit)}</b></div>
      <div class="bar" style="height:6px;margin-top:3px"><i style="width:${Math.max(0, t.profit) / max * 100}%;background:#8FD1A8"></i></div></div>`).join('') || '<span class="meta">아직 데이터가 없습니다</span>'}
  </div>`;
}

export async function renderReport() {
  const today = kstToday();
  if (state.day > today) state.day = today;
  seg($('repSeg'), [['day', '일일 마감'], ['month', '이번 달 누적']], state.mode, (k) => { state.mode = k; renderReport(); });
  const isDay = state.mode === 'day';
  let m, extra = '', monthChart = null, statusPill;
  if (isDay) {
    const ws = shift(state.day, -3) > shift(today, -6) ? shift(today, -6) : shift(state.day, -3);
    const week = daysBetween(ws, shift(ws, 6));
    await ensure(week[0], week[6]);
    m = modelOf(state.day);
    const st = statusOf(snapOf(state.day), state.day, today);
    $('rTitle').textContent = `${md(state.day)} (${dow(state.day)})`;
    $('rSub').textContent = snapOf(state.day)?.updated_at ? `발주 자동화 반영 ${new Date(snapOf(state.day).updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '발주일자 기준';
    $('rWeek').innerHTML = `<div class="week">${week.map((d) => `<button type="button" data-d="${d}" aria-pressed="${d === state.day}"${d > today ? ' disabled style="opacity:.35"' : ''}><small>${dow(d)}</small><b>${+d.slice(8)}</b><span class="dot ${statusOf(snapOf(d), d, today)}"></span></button>`).join('')}</div>
      <div class="legend"><span><span class="dot done"></span> 마감 확정</span><span><span class="dot check"></span> 담당자 확인 중</span><span><span class="dot live"></span> 오늘 진행 중</span></div>`;
    $('rWeek').querySelectorAll('button[data-d]').forEach((b) => { b.onclick = () => { state.day = b.dataset.d; renderReport(); }; });
    statusPill = { done: ['done', '마감 확정 · B2B 포함 최종 숫자'], check: ['check', '담당자 확인 중 · 숫자가 바뀔 수 있습니다'], live: ['live', '오늘 · 진행 중 (마감 전 숫자)'], none: ['check', '아직 보고서가 없습니다 — 발주 자동화에서 매출 보고서를 만들면 자동으로 올라옵니다'] }[st];
  } else {
    const from = monthStart(state.day), to = monthEnd(from) < today ? monthEnd(from) : today;
    const days = daysBetween(from, to);
    await ensure(from, to);
    const models = days.map(modelOf);
    m = sumModels(models);
    $('rTitle').textContent = `${from.slice(0, 4)}년 ${+from.slice(5, 7)}월`;
    $('rSub').textContent = `${md(from)} ~ ${md(to)} 누적`;
    $('rWeek').innerHTML = '';
    const best = days.reduce((a, d, i) => (models[i].sales > (a?.s || 0) ? { d, s: models[i].sales } : a), null);
    const closed = days.filter((d) => snapOf(d)?.status === 'confirmed').length;
    extra = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      <div class="card" style="background:var(--bg);padding:8px"><span class="meta">일평균 매출</span><b style="font-size:13px">${won(m.sales / days.length)}</b></div>
      <div class="card" style="background:var(--bg);padding:8px"><span class="meta">최고 매출일</span><b style="font-size:13px">${best ? `${+best.d.slice(8)}일 · ${won(best.s)}` : '-'}</b></div>
      <div class="card" style="background:var(--bg);padding:8px"><span class="meta">마감 확정</span><b style="font-size:13px">${closed}일 / ${days.length}일</b></div></div>`;
    monthChart = chart(days, (d) => { state.mode = 'day'; state.day = d; renderReport(); });
    statusPill = ['live', `${md(from)} ~ ${md(to)} 누적${to === today ? ' · 오늘(진행 중) 포함' : ''}`];
  }
  const phoneCnt = isDay ? phoneOf(state.day).length : 0;
  $('repMain').innerHTML = `
    <span class="pill ${statusPill[0]}">${esc(statusPill[1])}</span>
    ${state.role !== 'viewer' && isDay ? `<button class="card" type="button" id="toB2B" style="border:1px solid var(--line);text-align:left;font:inherit;color:inherit"><div class="row"><span><b style="font-size:13px">B2B 반영 상태</b><br><span class="meta">폰 입력 문자매출 ${phoneCnt}건 · 발주 자동화 직거래 · 디네트 · 또또는 보고서에 포함</span></span><span class="meta" style="color:var(--accent);font-weight:700">B2B 탭 ›</span></div></button>` : ''}
    ${summaryCard(m, extra)}
    ${monthChart ? `<div class="card"><div class="row"><b>일별 매출 · 순이익</b><span class="meta">막대를 누르면 그날 보고서</span></div>${monthChart.html}</div>` : ''}
    <b class="meta" style="padding:4px 4px 0;font-weight:700;color:var(--ink2)">사업자별 · 누르면 상세</b>
    ${BIZ.map((b) => bizCard(b, m.biz[b])).join('')}
    ${flowCard(m)}
    ${topCard(m)}`;
  if (monthChart) monthChart.bind($('repMain'));
  $('toMargin').onclick = () => state.go('margin');
  if ($('toB2B')) $('toB2B').onclick = () => state.go('b2b');
}

// ── 순마진 ────────────────────────────────────────────────
export async function renderMargin() {
  const today = kstToday();
  let m, label;
  if (state.mode === 'day') {
    await ensure(state.day, state.day);
    m = modelOf(state.day);
    label = `${md(state.day)} (${dow(state.day)})`;
  } else {
    const from = monthStart(state.day), to = monthEnd(from) < today ? monthEnd(from) : today;
    await ensure(from, to);
    m = sumModels(daysBetween(from, to).map(modelOf));
    label = `${md(from)} ~ ${md(to)} 누적`;
  }
  $('marSub').textContent = `${label} · 보고서 탭의 날짜 · 기간과 같이 바뀝니다`;
  $('marMain').innerHTML = `
    <div class="card meta" style="line-height:1.7;color:var(--ink2)"><b style="color:var(--ink)">순마진율 = 순이익 ÷ 매출</b>순이익 = 매출 − 매입 − 판매수수료 − 납부 부가세
      <span><span class="dot" style="background:#8FD1A8"></span> 6% 이상 &nbsp; <span class="dot" style="background:#F2C48D"></span> 6% 미만 (확인 필요)</span></div>
    <div class="card" style="display:grid;grid-template-columns:repeat(3,1fr)"><div><span class="meta">총 매출</span><br><b>${won(m.sales)}</b></div><div><span class="meta">순이익</span><br><b class="green">${won(m.profit)}</b></div><div style="text-align:right"><span class="meta">평균 순마진율</span><br><b class="green">${pct(m.profit, m.sales)}</b></div></div>
    ${BIZ.map((b) => {
      const bz = m.biz[b];
      const items = [];
      for (const c of Object.values(bz.channels)) for (const it of Object.values(c.items)) items.push({ ...it, ch: c.type === 'B2B' ? c.name : '자사몰', b2b: c.type === 'B2B' });
      items.sort((a, c) => (c.sales ? c.profit / c.sales : 0) - (a.sales ? a.profit / a.sales : 0));
      return `<div class="card">
        <div class="bizhead" style="background:${TINT[b]}"><div class="row"><b style="font-size:16px">${b}</b><b class="green">순마진율 ${pct(bz.profit, bz.sales)}</b></div>
          <span class="meta" style="color:var(--ink2)">매출 ${won(bz.sales)} · 매입 ${won(bz.purchase)} · 순이익 <b class="green">${won(bz.profit)}</b></span></div>
        <div class="tbl h" style="grid-template-columns:1.5fr 1fr 1fr .8fr;margin-top:6px"><span>품목</span><span class="r">매출</span><span class="r">순이익</span><span class="r">마진율</span></div>
        ${items.map((it) => {
          const r = it.sales ? it.profit / it.sales * 100 : 0, low = r < 6;
          return `<div class="tbl" style="grid-template-columns:1.5fr 1fr 1fr .8fr"><span>${esc(it.name)}<br><span class="meta" style="${it.b2b ? 'color:var(--warn)' : ''}">${esc(it.ch)} · ${won(it.count)}건</span></span><span class="r">${won(it.sales)}</span><b class="r green">${won(it.profit)}</b><b class="r ${low ? 'orange' : 'green'}">${r.toFixed(1)}%</b>
            <span style="grid-column:1/-1" class="bar"><i style="width:${Math.max(2, Math.min(100, r * 1.6))}%;background:${low ? '#F2C48D' : '#8FD1A8'}"></i></span></div>`;
        }).join('') || '<span class="meta" style="padding:8px 0">이 기간 매출이 없습니다</span>'}
      </div>`;
    }).join('')}`;
}

export function initViews(client, role, go) {
  db = client;
  state.role = role;
  state.go = go;
  $('rPrev').onclick = () => {
    if (state.mode === 'day') state.day = shift(state.day, -1);
    else state.day = shift(monthStart(state.day), -1);
    renderReport();
  };
  $('rNext').onclick = () => {
    const today = kstToday();
    if (state.mode === 'day') { if (state.day < today) state.day = shift(state.day, 1); }
    else { const n = shift(monthEnd(state.day), 1); if (n <= today) state.day = n; }
    renderReport();
  };
}
