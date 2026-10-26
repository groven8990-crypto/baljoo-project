// 쇼핑몰 API 로 가져온 주문을 저장하고, 처음 보는 주문만 팀원 폰으로 알립니다.
// collect-orders(서버에서 직접 조회)와 market-ingest(오라클 서버가 조회해서 보냄)가 같이 씁니다.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { pushToMembers } from "./push.ts";
import { ChannelAccount, NormalizedOrder } from "./types.ts";

export const PLATFORM_LABEL: Record<string, string> = { coupang: "쿠팡", naver: "네이버", "11st": "11번가", esm: "지마켓/옥션" };

const won = (n: number) => n.toLocaleString("ko-KR");

export function orderMessage(account: Pick<ChannelAccount, "platform" | "store_name">, rows: NormalizedOrder[]) {
  const head = `[${PLATFORM_LABEL[account.platform] ?? account.platform}-${account.store_name}]`;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const first = rows[0];
  const item = [first.product_name, first.option_name].filter(Boolean).join(" ");
  return rows.length === 1
    ? { title: `${head} 신규 주문`, body: `${item} ${first.qty}개 · ${won(total)}원` }
    : { title: `${head} 신규 주문 ${rows.length}건`, body: `${item} 외 ${rows.length - 1}건 · 합계 ${won(total)}원` };
}

// 이미 저장된 주문은 건너뛰고(on conflict do nothing) 새로 들어간 것만 알림.
// 처음 켠 계정(last_synced_at 없음)은 과거 주문이 한꺼번에 울리지 않도록 저장만 합니다.
export async function saveOrders(db: SupabaseClient, account: ChannelAccount, fetched: NormalizedOrder[], now: Date) {
  const { data: inserted, error } = fetched.length
    ? await db
      .from("orders")
      .upsert(fetched.map((o) => ({ ...o, account_id: account.id, platform: account.platform })), {
        onConflict: "platform,external_order_id,external_item_id",
        ignoreDuplicates: true,
      })
      .select()
    : { data: [], error: null };
  if (error) throw error;
  const fresh = (inserted ?? []) as NormalizedOrder[];

  let pushed = 0;
  if (fresh.length && account.last_synced_at) {
    pushed = await pushToMembers(db, "order", { ...orderMessage(account, fresh), url: "./#orders", tag: `order-${account.id}` });
  }
  await db.from("channel_accounts").update({ last_synced_at: now.toISOString(), last_error: null }).eq("id", account.id);
  return { fetched: fetched.length, new: fresh.length, pushed };
}
