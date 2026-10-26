// 오라클 무료 서버(고정 IP)에서 5분마다 실행: 쿠팡 · 네이버 새 주문을 조회해 발주 알리미 서버로 보냅니다.
// 저장 · 중복 제거 · 폰 알림은 서버(market-ingest)가 합니다.
// 설정: /etc/baljoo/accounts.json (계정 목록), /etc/baljoo/env (연동 키 · 쇼핑몰 키, systemd 가 환경변수로 넣어 줌)
import { fetchCoupang } from "./shared/coupang.ts";
import { fetchNaver } from "./shared/naver.ts";
import { Adapter, ChannelAccount, secret } from "./shared/types.ts";

const INGEST = "https://byanyksnvrqfrkeylvll.supabase.co/functions/v1/market-ingest";
const ADAPTERS: Partial<Record<string, Adapter>> = { coupang: fetchCoupang, naver: fetchNaver };
const OVERLAP_MS = 10 * 60_000;    // 지난 조회와 10분 겹쳐서 누락 방지
const FIRST_RUN_MS = 2 * 3600_000; // 처음 켠 계정은 최근 2시간만 (알림 없이 저장)

interface LocalAccount { id: string; platform: string; store_name: string; ref: string }

async function ingest(body: unknown) {
  const res = await fetch(INGEST, {
    method: "POST",
    headers: { "x-sync-key": secret("BALJOO_SYNC_KEY"), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`발주 알리미 서버 ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const accounts: LocalAccount[] = JSON.parse(await Deno.readTextFile(Deno.env.get("BALJOO_ACCOUNTS") ?? "/etc/baljoo/accounts.json"));
const state: Record<string, string | null> = await ingest({ action: "state", accounts });
const now = new Date();

for (const a of accounts) {
  const adapter = ADAPTERS[a.platform];
  if (!adapter) continue;
  const last = state[a.id];
  const since = last ? new Date(Date.parse(last) - OVERLAP_MS) : new Date(now.getTime() - FIRST_RUN_MS);
  const account = { id: a.id, platform: a.platform, store_name: a.store_name, business: "", secret_ref: a.ref, last_synced_at: last } as ChannelAccount;
  try {
    const orders = await adapter(account, since, now);
    const r = await ingest({ action: "orders", account_id: a.id, orders });
    console.log(`✅ ${a.id}: 조회 ${r.fetched}건 · 새 주문 ${r.new}건 · 알림 ${r.pushed}명${last ? "" : " (첫 연결: 알림 없이 저장)"}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`⚠️ ${a.id}: ${msg}`);
    await ingest({ action: "error", account_id: a.id, error: msg }).catch(() => {});
  }
}
