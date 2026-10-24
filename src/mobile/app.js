import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const won = (n) => (n || 0).toLocaleString('ko-KR');
const PLATFORM = { coupang: '쿠팡', naver: '네이버', '11st': '11번가', esm: '지마켓/옥션' };

const db = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let orders = [];
let accounts = {};
let filter = '전체';
const freshIds = new Set();

function show(id) {
  for (const s of ['login', 'app', 'noRole']) $(s).hidden = s !== id;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// 오늘 0시(KST)
function kstMidnight() {
  const now = new Date(Date.now() + 9 * 3600e3);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600e3);
}

function storeLabel(o) {
  const a = accounts[o.account_id];
  return a ? `${PLATFORM[a.platform] || a.platform}-${a.store_name}` : o.account_id;
}

function render() {
  const shown = orders.filter((o) => filter === '전체' || storeLabel(o) === filter);
  $('sCount').textContent = `${shown.length}건`;
  $('sQty').textContent = `${shown.reduce((a, o) => a + o.qty, 0)}개`;
  $('sAmt').textContent = `${won(shown.reduce((a, o) => a + o.amount, 0))}원`;

  const labels = ['전체', ...new Set(orders.map(storeLabel))];
  $('filters').replaceChildren(...labels.map((l) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = l;
    b.setAttribute('aria-pressed', String(l === filter));
    b.onclick = () => { filter = l; render(); };
    return b;
  }));

  const list = $('list');
  if (!shown.length) {
    list.innerHTML = '<div class="empty">아직 오늘 들어온 주문이 없습니다</div>';
    return;
  }
  list.replaceChildren(...shown.map((o) => {
    const c = document.createElement('div');
    c.className = 'card' + (freshIds.has(o.id) ? ' new' : '');
    const time = new Date(o.paid_at || o.ordered_at || o.first_seen_at)
      .toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
    c.innerHTML = `
      <div class="row"><span class="tag" data-f="store"></span><span class="meta" data-f="time"></span></div>
      <div class="row"><span class="name" data-f="name"></span><span class="amt" data-f="amt"></span></div>
      <span class="meta" data-f="meta"></span>`;
    const set = (f, v) => { c.querySelector(`[data-f="${f}"]`).textContent = v; };
    set('store', storeLabel(o));
    set('time', time);
    set('name', [o.product_name, o.option_name].filter(Boolean).join(' · '));
    set('amt', `${won(o.amount)}원`);
    set('meta', [`${o.qty}개`, o.buyer_masked, o.receiver_region].filter(Boolean).join(' · '));
    return c;
  }));
}

async function load() {
  const [{ data: accs }, { data: rows, error }] = await Promise.all([
    db.from('channel_accounts').select('id, platform, store_name, business'),
    db.from('orders').select('*').gte('first_seen_at', kstMidnight().toISOString()).order('paid_at', { ascending: false, nullsFirst: false }),
  ]);
  if (error) { toast('주문을 불러오지 못했습니다'); return; }
  accounts = Object.fromEntries((accs || []).map((a) => [a.id, a]));
  orders = rows || [];
  render();
}

// 새 주문이 저장되면 새로고침 없이 바로 목록 맨 위에 붙입니다
function listenRealtime() {
  db.channel('orders-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: o }) => {
      if (orders.some((x) => x.id === o.id)) return;
      freshIds.add(o.id);
      orders.unshift(o);
      render();
      toast(`새 주문 · ${storeLabel(o)} · ${won(o.amount)}원`);
    })
    .subscribe();
}

// ── 푸시 알림 켜기 ──────────────────────────────────────────
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function renderPushBox(userId) {
  const box = $('pushBox');
  if (!VAPID_PUBLIC_KEY) { box.innerHTML = ''; return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.innerHTML = isIOS && !standalone
      ? '<p class="notice warn">알림을 받으려면 Safari 공유 버튼 → <b>홈 화면에 추가</b> 후, 홈 화면 아이콘으로 열어 주세요.</p>'
      : '<p class="notice warn">이 브라우저는 푸시 알림을 지원하지 않습니다.</p>';
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing && Notification.permission === 'granted') {
    box.innerHTML = '<p class="notice ok">이 폰에서 신규 주문 알림을 받고 있습니다.</p>';
    return;
  }
  if (Notification.permission === 'denied') {
    box.innerHTML = '<p class="notice warn">알림이 차단되어 있습니다. 폰 설정 → 알림에서 이 앱을 허용해 주세요.</p>';
    return;
  }
  box.innerHTML = '<button class="btn" type="button">신규 주문 알림 켜기</button>';
  box.querySelector('button').onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') { renderPushBox(userId); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await db.from('push_subscriptions').upsert(
        { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
        { onConflict: 'endpoint' },
      );
      if (error) throw error;
      toast('알림을 켰습니다');
      renderPushBox(userId);
    } catch (e) {
      toast('알림 켜기 실패: ' + e.message);
    }
  };
}

// ── B2B 탭: 문자매출 입력 · 목록 ───────────────────────────
let me = null;
let userId = null;
let b2bRows = [];
let day = kstToday();

function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function shiftDay(d, n) {
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
}
const num = (v) => parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0;

function renderB2B() {
  const dt = new Date(day + 'T00:00:00Z');
  $('dLabel').textContent = dt.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }) + (day === kstToday() ? ' · 오늘' : '');
  $('dNext').disabled = day >= kstToday();
  const total = b2bRows.reduce((a, r) => a + r.sales, 0);
  $('b2bCount').textContent = `문자매출 ${b2bRows.length}건`;
  $('b2bTotal').textContent = `합계 ${won(total)}원`;
  const list = $('b2bList');
  if (!b2bRows.length) {
    list.innerHTML = '<div class="empty" style="padding:20px 0">이 날 들어온 문자매출이 없습니다</div>';
    return;
  }
  list.replaceChildren(...b2bRows.map((r) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'padding:10px 0;border-top:1px solid var(--line2);align-items:center';
    row.innerHTML = `
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
        <span class="name" data-f="item"></span>
        <span style="display:flex;gap:6px;align-items:center"><span data-f="src"></span><span class="meta" data-f="who"></span></span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <span class="amt" data-f="sales"></span><span class="meta" data-f="profit"></span>
      </div>
      <button class="del" type="button" aria-label="삭제">×</button>`;
    const set = (f, v) => { row.querySelector(`[data-f="${f}"]`).textContent = v; };
    set('item', `${r.item} ${r.qty}건`);
    const src = row.querySelector('[data-f="src"]');
    src.className = 'src' + (r.source === 'phone' ? ' phone' : '');
    src.textContent = r.source === 'phone' ? '폰 입력' : '발주 사이트';
    const time = new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
    set('who', r.source === 'phone' ? `${r.created_by_name || ''} · ${time}` : time);
    set('sales', `${won(r.sales)}원`);
    const p = row.querySelector('[data-f="profit"]');
    if (r.buy === null) { p.textContent = '매입 미입력'; p.style.color = 'var(--warn)'; }
    else { p.textContent = `순이익 ${won(r.sales - r.buy)}`; p.style.color = 'var(--ok)'; }
    row.querySelector('.del').onclick = async () => {
      if (!confirm(`${r.item} ${won(r.sales)}원을 매출에서 뺄까요?`)) return;
      const { error } = await db.from('b2b_sales').update({ deleted_at: new Date().toISOString() }).eq('id', r.id);
      if (error) { toast('삭제하지 못했습니다'); return; }
      toast('매출에서 뺐습니다');
      loadB2B();
    };
    return row;
  }));
}

async function loadB2B() {
  const { data, error } = await db.from('b2b_sales').select('*')
    .eq('sale_date', day).is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { toast('문자매출을 불러오지 못했습니다'); return; }
  b2bRows = data || [];
  renderB2B();
}

function toggleForm(open) {
  $('saleForm').hidden = !open;
  $('openForm').hidden = open;
  if (open) $('fItem').focus();
}

function updatePreview() {
  const s = num($('fSales').value);
  const b = $('fBuy').value.trim() ? num($('fBuy').value) : null;
  $('fPreview').textContent = !s ? '순이익 —' : b === null ? '매입 미입력' : `순이익 ${won(s - b)}원 (${((s - b) / s * 100).toFixed(1)}%)`;
}

async function saveSale(e) {
  e.preventDefault();
  const item = $('fItem').value.trim();
  const qty = num($('fQty').value) || 1;
  const sales = num($('fSales').value);
  const buy = $('fBuy').value.trim() ? num($('fBuy').value) : null;
  if (!item || !sales) { toast('품목과 매출액을 넣어 주세요'); return; }
  // 발주 사이트에서 이미 넣은 같은 건이 있으면 한 번 더 확인
  const dup = b2bRows.find((r) => r.sales === sales && r.item.replace(/\s/g, '') === item.replace(/\s/g, ''));
  if (dup && !confirm(`같은 날 같은 품목·금액이 이미 있습니다 (${dup.source === 'phone' ? '폰 입력' : '발주 사이트'}). 그래도 추가할까요?`)) return;
  const { error } = await db.from('b2b_sales').insert({
    sale_date: day, business: '그로븐', client: '직거래', item, qty, sales, buy,
    source: 'phone', created_by: userId, created_by_name: me.name,
  });
  if (error) { toast('저장하지 못했습니다: ' + error.message); return; }
  $('saleForm').reset();
  $('fQty').value = '1';
  updatePreview();
  toggleForm(false);
  toast('문자매출을 추가했습니다');
  loadB2B();
}

function listenB2B() {
  db.channel('b2b-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'b2b_sales' }, ({ new: r }) => {
      if (r && r.sale_date === day) loadB2B();
    })
    .subscribe();
}

// ── 탭 ──────────────────────────────────────────────────────
function showTab(tab) {
  $('viewB2B').hidden = tab !== 'b2b';
  $('viewCS').hidden = tab !== 'cs';
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

// ── 시작 ────────────────────────────────────────────────────
let startedFor = null;
async function start(session) {
  if (!session) { startedFor = null; show('login'); return; }
  if (startedFor === session.user.id) return;
  startedFor = session.user.id;
  userId = session.user.id;
  ({ data: me } = await db.from('members').select('name, role').eq('user_id', session.user.id).maybeSingle());
  if (!me || me.role === 'viewer') {
    $('noRoleMsg').textContent = !me
      ? '아직 팀원으로 등록되지 않은 계정입니다. 관리자에게 등록을 요청해 주세요.'
      : '주문 알림은 관리자·실무 권한에서만 볼 수 있습니다. 매출 보고서 화면은 다음 단계에서 열립니다.';
    show('noRole');
    return;
  }
  $('today').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }) + ` · ${me.name}`;
  $('b2bWho').textContent = `${me.name} · 담당자`;
  show('app');
  showTab(location.hash === '#orders' ? 'cs' : 'b2b');
  await Promise.all([load(), loadB2B()]);
  listenRealtime();
  listenB2B();
  renderPushBox(session.user.id);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithOtp({
    email: $('email').value.trim(),
    options: { emailRedirectTo: location.href.split('#')[0], shouldCreateUser: false },
  });
  const m = $('loginMsg');
  m.hidden = false;
  m.className = 'notice ' + (error ? 'warn' : 'ok');
  m.textContent = error ? '로그인 링크를 보내지 못했습니다. 초대받은 이메일인지 확인해 주세요.' : '메일함에서 로그인 링크를 눌러 주세요.';
};
$('refresh').onclick = load;
document.querySelectorAll('nav.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
window.addEventListener('hashchange', () => { if (location.hash === '#orders') showTab('cs'); });
$('openForm').onclick = () => toggleForm(true);
$('cancelForm').onclick = () => toggleForm(false);
$('saleForm').onsubmit = saveSale;
for (const id of ['fSales', 'fBuy']) $(id).oninput = updatePreview;
$('dPrev').onclick = () => { day = shiftDay(day, -1); loadB2B(); };
$('dNext').onclick = () => { if (day < kstToday()) { day = shiftDay(day, 1); loadB2B(); } };
$('logout').onclick = $('logout2').onclick = async () => { await db.auth.signOut(); location.reload(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) { load(); loadB2B(); } });

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.body.innerHTML = '<main><p class="notice warn">config.js 에 Supabase 주소와 키를 먼저 넣어 주세요.</p></main>';
} else {
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') start(session);
  });
}
