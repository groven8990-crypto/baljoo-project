// 쿠팡 Wing Open API — 발주서(주문) 목록 조회
// 필요한 비밀값: COUPANG_<ref>_ACCESS_KEY, COUPANG_<ref>_SECRET_KEY, COUPANG_<ref>_VENDOR_ID
import { Adapter, maskName, NormalizedOrder, regionOf, secret } from "./types.ts";

const HOST = "https://api-gateway.coupang.com";
// 결제완료(ACCEPT) · 상품준비중(INSTRUCT) 을 새 주문으로 봅니다
const STATUSES = ["ACCEPT", "INSTRUCT"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// 서명 시각: yyMMdd'T'HHmmss'Z' (UTC)
export function signedDate(d: Date): string {
  return `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authorization(accessKey: string, secretKey: string, method: string, path: string, query: string, now = new Date()) {
  const dt = signedDate(now);
  const signature = await hmacHex(secretKey, dt + method + path + query);
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${signature}`;
}

// KST 날짜 yyyy-MM-dd
function kstDay(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export const fetchCoupang: Adapter = async (account, since, now) => {
  const ref = account.secret_ref;
  const accessKey = secret(`COUPANG_${ref}_ACCESS_KEY`);
  const secretKey = secret(`COUPANG_${ref}_SECRET_KEY`);
  const vendorId = secret(`COUPANG_${ref}_VENDOR_ID`);
  const path = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`;
  const out: NormalizedOrder[] = [];

  for (const status of STATUSES) {
    let nextToken = "";
    do {
      const params = new URLSearchParams({
        createdAtFrom: kstDay(since),
        createdAtTo: kstDay(now),
        status,
        maxPerPage: "50",
      });
      if (nextToken) params.set("nextToken", nextToken);
      const query = params.toString();
      const res = await fetch(`${HOST}${path}?${query}`, {
        headers: {
          Authorization: await authorization(accessKey, secretKey, "GET", path, query),
          "Content-Type": "application/json;charset=UTF-8",
        },
      });
      if (!res.ok) throw new Error(`쿠팡 ${status} 조회 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      for (const sheet of body.data ?? []) {
        for (const item of sheet.orderItems ?? []) {
          out.push({
            external_order_id: String(sheet.orderId),
            external_item_id: String(item.vendorItemId ?? item.vendorItemPackageId ?? sheet.shipmentBoxId),
            status: sheet.status ?? status,
            ordered_at: sheet.orderedAt ? `${sheet.orderedAt}+09:00` : null,
            paid_at: sheet.paidAt ? `${sheet.paidAt}+09:00` : null,
            product_name: item.sellerProductName ?? item.vendorItemName ?? null,
            option_name: item.sellerProductItemName ?? null,
            qty: Number(item.shippingCount ?? 1),
            amount: Number(item.orderPrice ?? 0),
            buyer_masked: maskName(sheet.receiver?.name ?? sheet.orderer?.name),
            receiver_region: regionOf(sheet.receiver?.addr1),
          });
        }
      }
      nextToken = body.nextToken ?? "";
    } while (nextToken);
  }
  return out;
};
