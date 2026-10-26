// 5분마다 실행: 켜진 쇼핑몰 계정에서 새 주문을 가져와 저장하고, 새로 들어온 주문만 푸시로 알립니다.
// 호출 시 헤더 x-cron-secret 이 비밀값 CRON_SECRET 과 같아야 합니다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { fetchCoupang } from "../_shared/coupang.ts";
import { fetchNaver } from "../_shared/naver.ts";
import { saveOrders } from "../_shared/ingest.ts";
import { Adapter, ChannelAccount, secret } from "../_shared/types.ts";

const ADAPTERS: Partial<Record<ChannelAccount["platform"], Adapter>> = {
  coupang: fetchCoupang,
  naver: fetchNaver,
  // 11번가 · ESM(지마켓/옥션)은 API 키 발급 후 실제 응답을 보고 추가합니다
};

const OVERLAP_MS = 10 * 60_000;      // 지난 조회와 10분 겹쳐서 누락 방지
const FIRST_RUN_MS = 2 * 3600_000;   // 처음 켠 계정은 최근 2시간만

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
      report[account.id] = await saveOrders(db, account, fetched, now);
    } catch (e) {
      const msg = (e as Error).message;
      await db.from("channel_accounts").update({ last_error: msg.slice(0, 500) }).eq("id", account.id);
      report[account.id] = { error: msg };
    }
  }
  return Response.json(report);
});
