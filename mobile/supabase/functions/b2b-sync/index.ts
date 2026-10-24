// 발주 자동화 사이트(PC)에서 '직거래 주문 추가'를 하면 이 함수로 보냅니다.
// 헤더 x-sync-key 가 연동 키(BALJOO_SYNC_KEY)와 같아야 하고, 같은 주문번호는 덮어씁니다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseSyncBody } from "../_shared/b2b.ts";
import { secret, syncKey } from "../_shared/types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });
  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  if (req.headers.get("x-sync-key") !== await syncKey(db)) {
    return new Response("forbidden", { status: 403, headers: CORS });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 이 아닙니다" }, { status: 400, headers: CORS });
  }
  const row = parseSyncBody(body);
  if (typeof row === "string") return Response.json({ error: row }, { status: 400, headers: CORS });

  const { error } = await db
    .from("b2b_sales")
    .upsert({ ...row, source: "baljoo", created_by_name: "발주 사이트" }, { onConflict: "source_ref" });
  if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
  return Response.json({ ok: true }, { headers: CORS });
});
