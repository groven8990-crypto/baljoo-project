// 샵마인 발송대기 엑셀(행 배열)에서 주문 알림에 필요한 값만 뽑습니다.
// 열 찾는 방식과 주문금액 계산은 발주 자동화(src/index.html handleFile)와 같습니다.
import { maskName, NormalizedOrder, regionOf } from "./types.ts";

export interface ShopmineOrder extends NormalizedOrder {
  platform: string; // 판매처 이름 (예: 쿠팡-로또상회)
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// "2026-10-24 09:12:33" · "2026.10.24 09:12" · 엑셀 날짜 숫자 → ISO (한국 시간 기준)
export function kstIso(v: unknown): string | null {
  if (typeof v === "number" && v > 30000) {
    const ms = Math.round((v - 25569) * 86400e3) - 9 * 3600e3;
    return new Date(ms).toISOString();
  }
  const m = String(v ?? "").trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const p = (s: string | undefined) => (s ?? "0").padStart(2, "0");
  return new Date(`${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}+09:00`).toISOString();
}

// 샵마인 양식이 아니면 문자열(이유)을 돌려줍니다
export function parseShopmineRows(rows: unknown[][]): ShopmineOrder[] | string {
  let hr = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if ((rows[i] ?? []).indexOf("판매자상품코드") >= 0) { hr = i; break; }
  }
  if (hr < 0) return "샵마인 발송대기 양식이 아닙니다 (판매자상품코드 열 없음)";
  const H = rows[hr] as unknown[];
  const ci = (n: string) => H.indexOf(n);
  const findCol = (...names: string[]) => names.map(ci).find((i) => i >= 0) ?? -1;
  const C = {
    al: ci("별칭(쇼핑몰계정)"), sm: findCol("쇼핑몰", "마켓", "판매처", "마켓명", "판매채널", "쇼핑몰명"),
    on: ci("주문번호"), pn: ci("상품명"), so: ci("선택사항"), dop: ci("노출옵션명(쿠팡)"), qt: ci("수량"),
    by: ci("구매자"), ad: ci("주소"), od: ci("주문일시"),
  };
  if (C.on < 0) return "주문번호 열이 없습니다";
  const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");

  const out: ShopmineOrder[] = [];
  const seen = new Map<string, number>();
  for (const r of rows.slice(hr + 1) as unknown[][]) {
    if (!r || r.every((c) => c === "" || c == null)) continue;
    const orderNo = cell(r, C.on);
    if (!orderNo) continue;
    const product = cell(r, C.pn);
    const option = cell(r, C.so) || cell(r, C.dop);
    // 같은 주문 안에 같은 상품 줄이 여러 개여도 구분되도록 순번을 붙임
    const base = `${product}|${option}`.slice(0, 280);
    const n = (seen.get(orderNo + base) ?? 0) + 1;
    seen.set(orderNo + base, n);
    const ordered = kstIso(C.od >= 0 ? r[C.od] : "");
    out.push({
      platform: (cell(r, C.al) || cell(r, C.sm) || "샵마인").slice(0, 40),
      external_order_id: orderNo,
      external_item_id: `${base}#${n}`,
      status: null,
      ordered_at: ordered,
      paid_at: ordered,
      product_name: product || null,
      option_name: option || null,
      qty: Math.max(1, Math.round(num(r[C.qt]))),
      // 주문금액 = AB - AI + AH (발주 자동화 매출 계산과 동일)
      amount: Math.max(0, Math.round(num(r[27]) - num(r[34]) + num(r[33]))),
      buyer_masked: maskName(cell(r, C.by)),
      receiver_region: regionOf(cell(r, C.ad)),
    });
  }
  return out;
}

const won = (n: number) => n.toLocaleString("ko-KR");

// 푸시 문구: 한 판매처면 "[쿠팡-로또상회] 신규 주문 3건", 여러 곳이면 판매처별 건수
export function alertMessage(rows: ShopmineOrder[]): { title: string; body: string } {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const first = rows[0];
  const item = [first.product_name, first.option_name].filter(Boolean).join(" ");
  const byStore = new Map<string, number>();
  for (const r of rows) byStore.set(r.platform, (byStore.get(r.platform) ?? 0) + 1);
  if (rows.length === 1) return { title: `[${first.platform}] 신규 주문`, body: `${item} ${first.qty}개 · ${won(total)}원` };
  if (byStore.size === 1) return { title: `[${first.platform}] 신규 주문 ${rows.length}건`, body: `${item} 외 ${rows.length - 1}건 · 합계 ${won(total)}원` };
  return {
    title: `신규 주문 ${rows.length}건 · ${won(total)}원`,
    body: [...byStore].map(([s, c]) => `${s} ${c}`).join(" · "),
  };
}
