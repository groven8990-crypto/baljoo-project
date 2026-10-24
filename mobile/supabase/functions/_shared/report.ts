// 발주 자동화가 보낸 매출 보고 스냅샷을 검사하고, 저장에 필요한 숫자만 남깁니다.
// (주문자 이름 같은 개인정보가 섞여 들어와도 여기서 버립니다)

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : 0;
};
const str = (v: unknown, max = 80) => String(v ?? "").slice(0, max);

export interface ProfitRow {
  brand: string;
  isB2B: boolean;
  b2bName: string;
  item: string;
  option: string;
  count: number;
  sales: number;
  purchase: number;
  fee: number;
  vat: number;
  profit: number;
}

export interface ReportData {
  date: string;
  totalSales: number;
  totalCnt: number;
  adTotal: number;
  rows: ProfitRow[];
  plat: Record<string, Record<string, { count: number; sales: number }>>;
}

function platOf(agg: unknown): Record<string, { count: number; sales: number }> {
  const map = (agg as { platMap?: Record<string, { count?: unknown; sales?: unknown }> })?.platMap ?? {};
  const out: Record<string, { count: number; sales: number }> = {};
  for (const [k, v] of Object.entries(map)) out[str(k, 40)] = { count: n(v?.count), sales: n(v?.sales) };
  return out;
}

export function parseReportBody(b: Record<string, unknown>): { date: string; status: "draft" | "confirmed"; data: ReportData } | string {
  const status = b.status === "confirmed" ? "confirmed" : b.status === "draft" ? "draft" : null;
  if (!status) return "status 는 draft/confirmed";
  const snap = (b.snapshot ?? {}) as Record<string, unknown>;
  const date = String(snap.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "snapshot.date 형식(yyyy-mm-dd)이 아닙니다";
  if (!Array.isArray(snap.profitRows)) return "snapshot.profitRows 가 없습니다";
  const rows: ProfitRow[] = (snap.profitRows as Record<string, unknown>[]).slice(0, 2000).map((r) => ({
    brand: str(r.brand, 20),
    isB2B: !!r.isB2B,
    b2bName: str(r.b2bName, 40),
    item: str(r.item),
    option: str(r.option),
    count: n(r.count),
    sales: n(r.sales),
    purchase: n(r.purchase),
    fee: n(r.fee),
    vat: n(r.vat),
    profit: n(r.profit),
  }));
  return {
    date,
    status,
    data: {
      date,
      totalSales: n(snap.totalSales),
      totalCnt: n(snap.totalCnt),
      adTotal: n(snap.adTotal),
      rows,
      plat: { "그로븐": platOf(snap.grAgg), "옐로우브릿지": platOf(snap.ybAgg) },
    },
  };
}
