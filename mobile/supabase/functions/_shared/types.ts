// 쇼핑몰마다 다른 주문 응답을 이 모양 하나로 맞춰서 저장합니다.
export interface NormalizedOrder {
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

export interface ChannelAccount {
  id: string;
  platform: "coupang" | "naver" | "11st" | "esm";
  store_name: string;
  business: string;
  secret_ref: string;
  last_synced_at: string | null;
}

export type Adapter = (account: ChannelAccount, since: Date, now: Date) => Promise<NormalizedOrder[]>;

// 이름은 첫 글자만 남기고 가립니다: 김철수 → 김**
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim();
  if (s.length <= 1) return s;
  return s[0] + "*".repeat(s.length - 1);
}

// 주소는 시·도 + 시·군·구까지만: "경기도 연천군 전곡읍 …" → "경기도 연천군"
export function regionOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  return addr.trim().split(/\s+/).slice(0, 2).join(" ") || null;
}

export function secret(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`비밀값 ${name} 이(가) 설정되지 않았습니다`);
  return v;
}

// 발주 자동화 연동 키: 대시보드 Secrets 의 BALJOO_SYNC_KEY → 없으면 app_secrets 테이블 값
// deno-lint-ignore no-explicit-any
export async function syncKey(db: any): Promise<string> {
  const env = Deno.env.get("BALJOO_SYNC_KEY");
  if (env) return env;
  const { data } = await db.from("app_secrets").select("value").eq("name", "BALJOO_SYNC_KEY").maybeSingle();
  if (!data?.value) throw new Error("연동 키가 설정되지 않았습니다");
  return data.value;
}
