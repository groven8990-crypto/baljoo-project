// 발주 자동화가 매출 보고서를 만들거나(draft) 이력에 저장하면(confirmed) 이 함수로 보냅니다.
// 헤더 x-sync-key 가 비밀값 BALJOO_SYNC_KEY 와 같아야 합니다.
// 이미 확정(confirmed)된 날짜는 draft 로 되돌리지 않습니다 — 다시 '이력에 저장'해야 바뀝니다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseReportBody } from "../_shared/report.ts";
import { secret } from "../_shared/types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });
  if (req.headers.get("x-sync-key") !== secret("BALJOO_SYNC_KEY")) {
    return new Response("forbidden", { status: 403, headers: CORS });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 이 아닙니다" }, { status: 400, headers: CORS });
  }
  const parsed = parseReportBody(body);
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400, headers: CORS });

  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  if (parsed.status === "draft") {
    const { data: cur } = await db.from("report_snapshots").select("status").eq("report_date", parsed.date).maybeSingle();
    if (cur?.status === "confirmed") return Response.json({ ok: true, kept: "confirmed" }, { headers: CORS });
  }
  const { error } = await db.from("report_snapshots").upsert({
    report_date: parsed.date,
    status: parsed.status,
    data: parsed.data,
    updated_at: new Date().toISOString(),
  });
  if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
  return Response.json({ ok: true }, { headers: CORS });
});
