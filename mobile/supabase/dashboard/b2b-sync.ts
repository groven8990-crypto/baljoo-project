// Supabase 대시보드 → Edge Functions → Deploy a new function → Via Editor 에 이 파일 전체를 붙여 넣으세요.
// 함수 이름: b2b-sync  ·  배포 후 Details 에서 "Verify JWT" 끄기
// (원본: mobile/supabase/functions/b2b-sync — 붙여넣기용으로 한 파일에 합친 것)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// 쇼핑몰마다 다른 주문 응답을 이 모양 하나로 맞춰서 저장합니다.
interface NormalizedOrder {
  external_order_id: string;
  external_item_id: string;
  status: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  product_name: string | null;
  option_name: string | null;
  qty: number;
  amount: number;
  buyer_masked: string | null;
  receiver_region: string | null;
}

interface ChannelAccount {
  id: string;
  platform: "coupang" | "naver" | "11st" | "esm";
  store_name: string;
  business: string;
  secret_ref: string;
  last_synced_at: string | null;
}

type Adapter = (account: ChannelAccount, since: Date, now: Date) => Promise<NormalizedOrder[]>;

// 이름은 첫 글자만 남기고 가립니다: 김철수 → 김**
function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim();
  if (s.length <= 1) return s;
  return s[0] + "*".repeat(s.length - 1);
}

// 주소는 시·도 + 시·군·구까지만: "경기도 연천군 전곡읍 …" → "경기도 연천군"
function regionOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  return addr.trim().split(/\s+/).slice(0, 2).join(" ") || null;
}

function secret(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`비밀값 ${name} 이(가) 설정되지 않았습니다`);
  return v;
}

// 발주 자동화 연동 키: 대시보드 Secrets 의 BALJOO_SYNC_KEY → 없으면 app_secrets 테이블 값
// deno-lint-ignore no-explicit-any
async function syncKey(db: any): Promise<string> {
  const env = Deno.env.get("BALJOO_SYNC_KEY");
  if (env) return env;
  const { data } = await db.from("app_secrets").select("value").eq("name", "BALJOO_SYNC_KEY").maybeSingle();
  if (!data?.value) throw new Error("연동 키가 설정되지 않았습니다");
  return data.value;
}

// 발주 사이트에서 온 직거래 주문을 검사해서 b2b_sales 저장 모양으로 바꿉니다.

const toInt = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface SyncRow {
  source_ref: string;
  sale_date: string;
  business: string;
  client: string | null;
  item: string;
  qty: number;
  sales: number;
  buy: number | null;
}

// 들어온 값을 검사해서 저장할 모양으로 바꿉니다. 문제가 있으면 이유 문자열을 돌려줍니다.
function parseSyncBody(b: Record<string, unknown>): SyncRow | string {
  const ref = String(b.order_no ?? "").trim();
  if (!/^직거래\d/.test(ref)) return "order_no 가 직거래 주문번호가 아닙니다";
  const date = String(b.order_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "order_date 형식(yyyy-mm-dd)이 아닙니다";
  const business = String(b.business ?? "");
  if (business !== "그로븐" && business !== "옐로우브릿지") return "business 는 그로븐/옐로우브릿지 중 하나";
  const item = String(b.item ?? "").trim();
  if (!item) return "item 이 비어 있습니다";
  const qty = toInt(b.qty);
  const sales = toInt(b.sales);
  if (!qty || sales === null) return "qty/sales 가 올바르지 않습니다";
  const buy = b.buy === null || b.buy === undefined || b.buy === "" ? null : toInt(b.buy);
  return { source_ref: ref, sale_date: date, business, client: maskName(String(b.client ?? "")), item, qty, sales, buy };
}

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
