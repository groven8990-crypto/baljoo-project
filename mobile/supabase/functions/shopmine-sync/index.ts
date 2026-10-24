// PC 의 샵마인 알림 스크립트(tools/shopmine-order-alert)가 샵마인 엑셀 파일을 그대로 올리면,
// 주문을 읽어 처음 보는 주문만 저장하고 담당자 폰으로 푸시를 보냅니다. 파일 자체는 저장하지 않습니다.
// 헤더 x-sync-key 가 연동 키(BALJOO_SYNC_KEY)와 같아야 합니다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";
import { pushToStaff } from "../_shared/push.ts";
import { alertMessage, parseShopmineRows, ShopmineOrder } from "../_shared/shopmine.ts";
import { secret, syncKey } from "../_shared/types.ts";

const ACCOUNT = "shopmine";
const RECENT_MS = 24 * 3600e3; // 이보다 오래된 주문은 저장만 하고 알리지 않음

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  if (req.headers.get("x-sync-key") !== await syncKey(db)) return new Response("forbidden", { status: 403 });

  let rows: unknown[][];
  try {
    const wb = XLSX.read(new Uint8Array(await req.arrayBuffer()), { type: "array" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
  } catch (e) {
    return Response.json({ error: "엑셀을 읽지 못했습니다: " + (e as Error).message }, { status: 400 });
  }
  const parsed = parseShopmineRows(rows);
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });

  const { data: acc } = await db.from("channel_accounts").select("last_synced_at").eq("id", ACCOUNT).single();
  const firstRun = !acc?.last_synced_at;

  // 이미 저장된 주문은 건너뛰고(on conflict do nothing) 새로 들어간 것만 돌려받습니다
  const { data: inserted, error } = parsed.length
    ? await db.from("orders")
      .upsert(parsed.map((o) => ({ ...o, account_id: ACCOUNT })), {
        onConflict: "platform,external_order_id,external_item_id",
        ignoreDuplicates: true,
      })
      .select()
    : { data: [], error: null };
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const fresh = ((inserted ?? []) as ShopmineOrder[])
    .filter((o) => !o.ordered_at || now - Date.parse(o.ordered_at) < RECENT_MS);
  // 처음 연결할 때는 이미 쌓인 발송대기 주문이 한꺼번에 울리지 않도록 저장만
  let pushed = 0;
  if (fresh.length && !firstRun) {
    pushed = await pushToStaff(db, "order", { ...alertMessage(fresh), url: "./#orders", tag: "order-shopmine" });
  }
  await db.from("channel_accounts").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", ACCOUNT);
  return Response.json({ rows: parsed.length, new: (inserted ?? []).length, pushed, first_run: firstRun });
});
