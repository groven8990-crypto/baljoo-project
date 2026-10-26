// 오라클 무료 서버(고정 IP)의 주문 수집 프로그램(tools/order-collector)이 부르는 곳.
// 쿠팡 · 네이버는 등록한 IP 에서만 API 를 열어 주므로, 조회는 그 서버가 하고 여기서는 저장 · 알림만 합니다.
// 헤더 x-sync-key 가 연동 키(BALJOO_SYNC_KEY)와 같아야 합니다.
//   { action: "state", accounts: [{ id, platform, store_name, business }] } → 계정을 등록하고 { id: last_synced_at } 반환
//   { action: "orders", account_id, orders: NormalizedOrder[] }            → 저장 + 새 주문 알림
//   { action: "error", account_id, error }                                 → 조회 실패 기록 (설정 화면 표시용)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { saveOrders } from "../_shared/ingest.ts";
import { ChannelAccount, maskName, NormalizedOrder, regionOf, secret, syncKey } from "../_shared/types.ts";

const PLATFORMS = ["coupang", "naver", "11st", "esm"];
const BUSINESS: Record<string, string> = { 로또상회: "그로븐", 자꾸가게: "옐로우브릿지" };

const str = (v: unknown, max: number) => (v == null || v === "" ? null : String(v).slice(0, max));

// 서버에서 한 번 더 개인정보를 줄이고 모양을 맞춥니다 (수집 프로그램이 바뀌어도 이름 · 주소 원문은 저장되지 않게)
function clean(o: Record<string, unknown>): NormalizedOrder | null {
  const orderId = str(o.external_order_id, 100);
  if (!orderId) return null;
  return {
    external_order_id: orderId,
    external_item_id: str(o.external_item_id, 300) ?? orderId,
    status: str(o.status, 40),
    ordered_at: str(o.ordered_at, 40),
    paid_at: str(o.paid_at, 40),
    product_name: str(o.product_name, 300),
    option_name: str(o.option_name, 300),
    qty: Math.max(1, Math.round(Number(o.qty) || 1)),
    amount: Math.max(0, Math.round(Number(o.amount) || 0)),
    buyer_masked: maskName(str(o.buyer_masked, 40)),
    receiver_region: regionOf(str(o.receiver_region, 200)),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  if (req.headers.get("x-sync-key") !== await syncKey(db)) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;

  if (b.action === "state") {
    const list = (Array.isArray(b.accounts) ? b.accounts : []) as Record<string, string>[];
    const rows = list
      .filter((a) => /^[a-z0-9-]{3,40}$/.test(a.id ?? "") && PLATFORMS.includes(a.platform))
      .map((a) => ({
        id: a.id,
        platform: a.platform,
        store_name: String(a.store_name ?? "").slice(0, 40) || a.id,
        business: BUSINESS[a.store_name] ?? (String(a.business ?? "").slice(0, 40) || "-"),
        secret_ref: "VM",
        enabled: true,
      }));
    if (rows.length) {
      // 이미 있는 계정은 last_synced_at 을 건드리지 않음
      const { error } = await db.from("channel_accounts").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    const { data } = await db.from("channel_accounts").select("id, last_synced_at").in("id", rows.map((r) => r.id));
    return Response.json(Object.fromEntries((data ?? []).map((r) => [r.id, r.last_synced_at])));
  }

  const { data: account } = await db.from("channel_accounts").select("*").eq("id", String(b.account_id ?? "")).maybeSingle();
  if (!account || !PLATFORMS.includes(account.platform)) return Response.json({ error: "등록되지 않은 계정" }, { status: 400 });

  if (b.action === "error") {
    await db.from("channel_accounts").update({ last_error: String(b.error ?? "").slice(0, 500) }).eq("id", account.id);
    return Response.json({ ok: true });
  }

  if (b.action === "orders") {
    const orders = (Array.isArray(b.orders) ? b.orders : []).slice(0, 2000)
      .map((o) => clean(o as Record<string, unknown>)).filter((o): o is NormalizedOrder => !!o);
    try {
      return Response.json(await saveOrders(db, account as ChannelAccount, orders, new Date()));
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }
  return Response.json({ error: "알 수 없는 요청" }, { status: 400 });
});
