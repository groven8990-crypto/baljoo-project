// 5분마다 실행: 켜진 쇼핑몰 계정에서 새 주문을 가져와 저장하고, 새로 들어온 주문만 푸시로 알립니다.
// 호출 시 헤더 x-cron-secret 이 비밀값 CRON_SECRET 과 같아야 합니다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { fetchCoupang } from "../_shared/coupang.ts";
import { fetchNaver } from "../_shared/naver.ts";
import { pushToStaff } from "../_shared/push.ts";
import { Adapter, ChannelAccount, NormalizedOrder, secret } from "../_shared/types.ts";

const ADAPTERS: Partial<Record<ChannelAccount["platform"], Adapter>> = {
  coupang: fetchCoupang,
  naver: fetchNaver,
  // 11번가 · ESM(지마켓/옥션)은 API 키 발급 후 실제 응답을 보고 추가합니다
};

const PLATFORM_LABEL: Record<string, string> = { coupang: "쿠팡", naver: "네이버", "11st": "11번가", esm: "지마켓/옥션" };
const OVERLAP_MS = 10 * 60_000;      // 지난 조회와 10분 겹쳐서 누락 방지
const FIRST_RUN_MS = 2 * 3600_000;   // 처음 켠 계정은 최근 2시간만

const won = (n: number) => n.toLocaleString("ko-KR");

function message(account: ChannelAccount, rows: NormalizedOrder[]) {
  const head = `[${PLATFORM_LABEL[account.platform]}-${account.store_name}]`;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const first = rows[0];
  const item = [first.product_name, first.option_name].filter(Boolean).join(" ");
  return rows.length === 1
    ? { title: `${head} 신규 주문`, body: `${item} ${first.qty}개 · ${won(total)}원` }
    : { title: `${head} 신규 주문 ${rows.length}건`, body: `${item} 외 ${rows.length - 1}건 · 합계 ${won(total)}원` };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== secret("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: accounts, error } = await db.from("channel_accounts").select("*").eq("enabled", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const report: Record<string, unknown> = {};

  for (const account of (accounts ?? []) as ChannelAccount[]) {
    const adapter = ADAPTERS[account.platform];
    if (!adapter) {
      report[account.id] = "아직 연동 안 된 쇼핑몰";
      continue;
    }
    const firstRun = !account.last_synced_at;
    const since = firstRun
      ? new Date(now.getTime() - FIRST_RUN_MS)
      : new Date(new Date(account.last_synced_at!).getTime() - OVERLAP_MS);
    try {
      const fetched = await adapter(account, since, now);
      // 이미 저장된 주문은 건너뛰고(on conflict do nothing) 새로 들어간 것만 돌려받습니다
      const { data: inserted, error: insErr } = fetched.length
        ? await db
          .from("orders")
          .upsert(fetched.map((o) => ({ ...o, account_id: account.id, platform: account.platform })), {
            onConflict: "platform,external_order_id,external_item_id",
            ignoreDuplicates: true,
          })
          .select()
        : { data: [], error: null };
      if (insErr) throw insErr;
      const fresh = (inserted ?? []) as NormalizedOrder[];

      // 처음 켠 계정은 과거 주문이 한꺼번에 울리지 않도록 알림 없이 저장만
      let sent = 0;
      if (fresh.length && !firstRun) {
        sent = await pushToStaff(db, "order", { ...message(account, fresh), url: "./#orders", tag: `order-${account.id}` });
      }
      await db.from("channel_accounts").update({ last_synced_at: now.toISOString(), last_error: null }).eq("id", account.id);
      report[account.id] = { fetched: fetched.length, new: fresh.length, pushed: sent };
    } catch (e) {
      const msg = (e as Error).message;
      await db.from("channel_accounts").update({ last_error: msg.slice(0, 500) }).eq("id", account.id);
      report[account.id] = { error: msg };
    }
  }
  return Response.json(report);
});
