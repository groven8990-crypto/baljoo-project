// 설정 탭: 신규 주문 알림 켜고 끄기 · 내 계정 · (담당자만) 팀원 관리 · PC 연동 상태
import { SUPABASE_URL, VAPID_PUBLIC_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
export const ROLE_LABEL = { admin: '담당자', staff: '보기 전용', viewer: '보기 전용' };

let db, me, user, toast;

// ── 신규 주문 알림 ─────────────────────────────────────────
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function setSwitch(on, note) {
  const sw = $('pushToggle');
  sw.setAttribute('aria-checked', String(on));
  sw.disabled = !!note;
  $('pushNote').hidden = !note;
  $('pushNote').textContent = note || '';
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

async function renderPush() {
  if (!VAPID_PUBLIC_KEY) return setSwitch(false, '알림 설정이 아직 준비되지 않았습니다.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return setSwitch(false, isIOS && !standalone
      ? '알림을 받으려면 Safari 공유 버튼 → 홈 화면에 추가 후, 홈 화면 아이콘으로 열어 주세요.'
      : '이 브라우저는 알림을 지원하지 않습니다.');
  }
  if (Notification.permission === 'denied') return setSwitch(false, '알림이 차단되어 있습니다. 폰 설정 → 알림 → 발주 알리미에서 허용해 주세요.');
  const { sub } = await currentSub();
  if (!sub || Notification.permission !== 'granted') return setSwitch(false);
  const { data } = await db.from('push_subscriptions').select('prefs').eq('endpoint', sub.endpoint).maybeSingle();
  setSwitch(!!data && data.prefs?.order !== false);
}

async function togglePush() {
  const turnOn = $('pushToggle').getAttribute('aria-checked') !== 'true';
  try {
    if (turnOn) {
      if ((await Notification.requestPermission()) !== 'granted') return renderPush();
      const { reg, sub: old } = await currentSub();
      const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await db.from('push_subscriptions').upsert(
        { user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, prefs: { order: true } },
        { onConflict: 'endpoint' },
      );
      if (error) throw error;
      toast('신규 주문 알림을 켰습니다');
    } else {
      const { sub } = await currentSub();
      if (sub) {
        const { error } = await db.from('push_subscriptions').update({ prefs: { order: false } }).eq('endpoint', sub.endpoint);
        if (error) throw error;
      }
      toast('신규 주문 알림을 껐습니다');
    }
  } catch (e) {
    toast('알림 설정 실패: ' + e.message);
  }
  renderPush();
}

// ── 팀원 관리 (담당자) ─────────────────────────────────────
async function team(body) {
  const { data: { session } } = await db.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/team-admin`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `오류 ${r.status}`);
  return j;
}

function showPassword(name, email, password) {
  const m = $('teamMsg');
  m.hidden = false;
  m.innerHTML = '';
  m.append(`${name}님 로그인 정보 — 이메일 ${email} · 임시 비밀번호 `, Object.assign(document.createElement('b'), { textContent: password }),
    document.createElement('br'), '팀원에게 전달하고, 처음 로그인 후 설정에서 비밀번호를 바꾸도록 안내해 주세요.');
}

async function renderTeam() {
  const list = $('teamList');
  let rows;
  try { rows = await team({ action: 'list' }); } catch (e) { list.innerHTML = `<p class="meta">팀원 목록을 불러오지 못했습니다 (${e.message})</p>`; return; }
  list.replaceChildren(...rows.map((m) => {
    const el = document.createElement('div');
    el.className = 'mem';
    el.innerHTML = `<div class="who"><span class="name" data-f="n"></span><span class="meta" data-f="e"></span></div>
      <select aria-label="권한"><option value="viewer">보기 전용</option><option value="admin">담당자</option></select>
      <button class="more" type="button" aria-expanded="false">관리</button>
      <div class="acts" hidden><button type="button" data-a="reset">비밀번호 초기화</button><button type="button" data-a="remove" class="danger">삭제 (퇴사)</button></div>`;
    el.querySelector('[data-f=n]').textContent = m.user_id === user.id ? `${m.name} (나)` : m.name;
    el.querySelector('[data-f=e]').textContent = m.email;
    const sel = el.querySelector('select');
    sel.value = m.role === 'admin' ? 'admin' : 'viewer';
    sel.disabled = m.user_id === user.id;
    sel.onchange = async () => {
      try { await team({ action: 'role', user_id: m.user_id, role: sel.value }); toast(`${m.name} → ${ROLE_LABEL[sel.value]}`); } catch (e) { toast(e.message); renderTeam(); }
    };
    const more = el.querySelector('.more');
    const acts = el.querySelector('.acts');
    more.hidden = m.user_id === user.id;
    more.onclick = () => { acts.hidden = !acts.hidden; more.setAttribute('aria-expanded', String(!acts.hidden)); };
    acts.querySelector('[data-a=reset]').onclick = async () => {
      if (!confirm(`${m.name}님 비밀번호를 새 임시 비밀번호로 바꿀까요?`)) return;
      try { const { password } = await team({ action: 'reset', user_id: m.user_id }); showPassword(m.name, m.email, password); } catch (e) { toast(e.message); }
    };
    acts.querySelector('[data-a=remove]').onclick = async () => {
      if (!confirm(`${m.name} 계정을 삭제할까요?\n바로 로그인 · 조회 · 알림이 모두 막히고, 되돌릴 수 없습니다.`)) return;
      try { await team({ action: 'remove', user_id: m.user_id }); toast(`${m.name} 계정을 삭제했습니다`); renderTeam(); } catch (e) { toast(e.message); }
    };
    return el;
  }));
}

async function renderPcStatus() {
  const { data: acc } = await db.from('channel_accounts').select('last_synced_at').eq('id', 'shopmine').maybeSingle();
  const t = acc?.last_synced_at;
  $('smLast').textContent = t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '아직 없음';
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
    .eq('account_id', 'shopmine').gte('first_seen_at', new Date(today + 'T00:00:00+09:00').toISOString());
  $('smToday').textContent = `${count ?? 0}건`;
}

// ── 시작 ───────────────────────────────────────────────────
export function initSettings(client, member, sessionUser, toastFn) {
  db = client; me = member; user = sessionUser; toast = toastFn;
  $('setWho').textContent = `${me.name} · ${ROLE_LABEL[me.role]}`;
  $('myName').textContent = me.name;
  $('myEmail').textContent = user.email || '';
  $('myRole').textContent = ROLE_LABEL[me.role];
  $('adminBox').hidden = me.role !== 'admin';
  $('pushToggle').onclick = togglePush;
  $('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: $('newPw').value });
    const m = $('pwMsg');
    m.hidden = false;
    m.className = error ? 'notice warn' : 'notice ok';
    m.textContent = error ? '변경하지 못했습니다: ' + error.message : '비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.';
    if (!error) $('newPw').value = '';
  };
  if (me.role === 'admin') {
    $('addMember').onclick = () => { $('memberForm').hidden = false; $('addMember').hidden = true; $('mName').focus(); };
    $('mCancel').onclick = () => { $('memberForm').hidden = true; $('addMember').hidden = false; };
    $('memberForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('mName').value.trim();
      try {
        const r = await team({ action: 'add', name, email: $('mEmail').value, role: $('mRole').value });
        showPassword(name, r.email, r.password);
        $('memberForm').reset();
        $('mCancel').onclick();
        renderTeam();
      } catch (err) { toast(err.message); }
    };
  }
}

export function renderSettings() {
  renderPush();
  if (me.role === 'admin') { renderTeam(); renderPcStatus(); }
}
