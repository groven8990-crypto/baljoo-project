// 네이버 커머스API — 결제 완료된 상품주문 조회
// 필요한 비밀값: NAVER_<ref>_CLIENT_ID, NAVER_<ref>_CLIENT_SECRET
import bcrypt from "npm:bcryptjs@2.4.3";
import { Adapter, maskName, NormalizedOrder, regionOf, secret } from "./types.ts";

const HOST = "https://api.commerce.naver.com/external";

// client_secret_sign = base64( bcrypt( "{client_id}_{timestamp}", client_secret ) )
export function clientSecretSign(clientId: string, clientSecret: string, timestamp: number): string {
  const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret);
  return btoa(hashed);
}

async function token(clientId: string, clientSecret: string): Promise<string> {
  const timestamp = Date.now();
  const res = await fetch(`${HOST}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      timestamp: String(timestamp),
      client_secret_sign: clientSecretSign(clientId, clientSecret, timestamp),
      grant_type: "client_credentials",
      type: "SELF",
    }),
  });
  if (!res.ok) throw new Error(`네이버 토큰 발급 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

// KST 오프셋을 붙인 ISO 시각
function kstIso(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().replace("Z", "+09:00");
}

export const fetchNaver: Adapter = async (account, since) => {
  const ref = account.secret_ref;
  const clientId = secret(`NAVER_${ref}_CLIENT_ID`);
  const accessToken = await token(clientId, secret(`NAVER_${ref}_CLIENT_SECRET`));
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // 1) 결제(PAYED)로 바뀐 상품주문번호 목록
  const params = new URLSearchParams({ lastChangedFrom: kstIso(since), lastChangedType: "PAYED" });
  const listRes = await fetch(`${HOST}/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`, { headers });
  if (!listRes.ok) throw new Error(`네이버 변경 주문 조회 실패 ${listRes.status}: ${(await listRes.text()).slice(0, 200)}`);
  const ids: string[] = ((await listRes.json()).data?.lastChangeStatuses ?? []).map((s: { productOrderId: string }) => s.productOrderId);
  if (!ids.length) return [];

  // 2) 상세 조회 (한 번에 최대 300건)
  const out: NormalizedOrder[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const res = await fetch(`${HOST}/v1/pay-order/seller/product-orders/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ productOrderIds: ids.slice(i, i + 300) }),
    });
    if (!res.ok) throw new Error(`네이버 주문 상세 조회 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for (const row of (await res.json()).data ?? []) {
      const o = row.order ?? {};
      const p = row.productOrder ?? {};
      out.push({
        external_order_id: String(o.orderId),
        external_item_id: String(p.productOrderId),
        status: p.productOrderStatus ?? null,
        ordered_at: o.orderDate ?? null,
        paid_at: o.paymentDate ?? null,
        product_name: p.productName ?? null,
        option_name: p.productOption ?? null,
        qty: Number(p.quantity ?? 1),
        amount: Number(p.totalPaymentAmount ?? 0),
        buyer_masked: maskName(p.shippingAddress?.name ?? o.ordererName),
        receiver_region: regionOf(p.shippingAddress?.baseAddress),
      });
    }
  }
  return out;
};
