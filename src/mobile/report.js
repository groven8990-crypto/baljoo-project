// 매출 보고 계산 — 발주 자동화가 보낸 날짜별 스냅샷(report_snapshots) + 폰에서 넣은 문자매출(b2b_sales)을
// 화면에 그릴 모양으로 합칩니다. 화면 코드와 분리해 두어 숫자만 따로 검증할 수 있습니다.

export const BIZ = ['그로븐', '옐로우브릿지'];

function emptyBiz() {
  return { sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, profit: 0, plats: {}, channels: {} };
}
export function emptyModel() {
  return { sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, ad: 0, profit: 0, own: 0, b2b: 0, biz: { 그로븐: emptyBiz(), 옐로우브릿지: emptyBiz() } };
}

function addTo(t, r) {
  t.sales += r.sales; t.count += r.count; t.purchase += r.purchase; t.fee += r.fee; t.vat += r.vat; t.profit += r.profit;
}

function addRow(m, bizName, type, chName, label, r) {
  const b = m.biz[bizName];
  if (!b) return;
  const ch = b.channels[chName] || (b.channels[chName] = { type, name: chName, sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, profit: 0, items: {} });
  const it = ch.items[label] || (ch.items[label] = { name: label, sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, profit: 0 });
  addTo(it, r); addTo(ch, r); addTo(b, r); addTo(m, r);
  if (type === 'B2B') m.b2b += r.sales; else m.own += r.sales;
}

// 하루치: snap = report_snapshots 행 (없으면 null), phone = 그날 폰 입력 문자매출(source='phone')
export function dayModel(snap, phone = []) {
  const m = emptyModel();
  const d = snap?.data;
  if (d) {
    for (const r of d.rows || []) {
      const biz = BIZ.includes(r.brand) ? r.brand : null;
      if (!biz) continue;
      const label = [r.item, r.option].filter(Boolean).join(' ');
      const row = { sales: r.sales || 0, count: r.count || 0, purchase: r.purchase || 0, fee: r.fee || 0, vat: r.vat || 0, profit: r.profit || 0 };
      if (r.isB2B) addRow(m, biz, 'B2B', r.b2bName || 'B2B', label, row);
      else addRow(m, biz, '자사', '자사몰', label, row);
    }
    for (const biz of BIZ) {
      for (const [p, v] of Object.entries(d.plat?.[biz] || {})) {
        const t = m.biz[biz].plats[p] || (m.biz[biz].plats[p] = { count: 0, sales: 0 });
        t.count += v.count || 0; t.sales += v.sales || 0;
      }
    }
    m.ad = d.adTotal || 0;
    m.profit -= m.ad;
  }
  for (const s of phone) {
    const buy = s.buy ?? 0;
    addRow(m, BIZ.includes(s.business) ? s.business : '그로븐', 'B2B', '직거래', s.item,
      { sales: s.sales, count: s.qty, purchase: buy, fee: 0, vat: 0, profit: s.sales - buy });
  }
  return m;
}

// 여러 날 합치기 (주간 · 월간)
export function sumModels(models) {
  const out = emptyModel();
  for (const m of models) {
    out.ad += m.ad; out.own += m.own; out.b2b += m.b2b;
    for (const k of ['sales', 'count', 'purchase', 'fee', 'vat', 'profit']) out[k] += m[k];
    for (const biz of BIZ) {
      const src = m.biz[biz], dst = out.biz[biz];
      for (const k of ['sales', 'count', 'purchase', 'fee', 'vat', 'profit']) dst[k] += src[k];
      for (const [p, v] of Object.entries(src.plats)) {
        const t = dst.plats[p] || (dst.plats[p] = { count: 0, sales: 0 });
        t.count += v.count; t.sales += v.sales;
      }
      for (const ch of Object.values(src.channels)) {
        const dc = dst.channels[ch.name] || (dst.channels[ch.name] = { type: ch.type, name: ch.name, sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, profit: 0, items: {} });
        addTo(dc, ch);
        for (const it of Object.values(ch.items)) {
          const di = dc.items[it.name] || (dc.items[it.name] = { name: it.name, sales: 0, count: 0, purchase: 0, fee: 0, vat: 0, profit: 0 });
          addTo(di, it);
        }
      }
    }
  }
  return out;
}

// 날짜 상태: confirmed → 확정, 지난 날 draft → 확인 중, 오늘 draft → 진행 중, 없으면 none
export function statusOf(snap, date, today) {
  if (!snap) return date === today ? 'live' : 'none';
  if (snap.status === 'confirmed') return 'done';
  return date === today ? 'live' : 'check';
}

export const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '0%');
export const won = (n) => Math.round(n || 0).toLocaleString('ko-KR');
