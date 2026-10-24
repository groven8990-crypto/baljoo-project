// 발주 사이트에서 온 직거래 주문을 검사해서 b2b_sales 저장 모양으로 바꿉니다.
import { maskName } from "./types.ts";

const toInt = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export interface SyncRow {
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
export function parseSyncBody(b: Record<string, unknown>): SyncRow | string {
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
