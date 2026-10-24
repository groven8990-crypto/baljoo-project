// deno test --no-config --node-modules-dir=none mobile/supabase/functions/tests/
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import bcrypt from "npm:bcryptjs@2.4.3";
import { authorization, signedDate } from "../_shared/coupang.ts";
import { clientSecretSign } from "../_shared/naver.ts";
import { maskName, regionOf } from "../_shared/types.ts";

Deno.test("이름 마스킹 · 주소 축약", () => {
  assertEquals(maskName("김철수"), "김**");
  assertEquals(maskName("이"), "이");
  assertEquals(maskName(null), null);
  assertEquals(regionOf("경기도 연천군 전곡읍 전곡리 123"), "경기도 연천군");
});

Deno.test("쿠팡 서명 시각 형식", () => {
  assertEquals(signedDate(new Date("2026-10-24T01:02:03Z")), "261024T010203Z");
});

Deno.test("쿠팡 Authorization 헤더 형식", async () => {
  const h = await authorization("AK", "SK", "GET", "/v2/x", "a=1", new Date("2026-10-24T01:02:03Z"));
  assertMatch(h, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=261024T010203Z, signature=[0-9a-f]{64}$/);
});

Deno.test("네이버 client_secret_sign 은 bcrypt 결과의 base64", () => {
  const salt = bcrypt.genSaltSync(4);
  const sign = clientSecretSign("cid", salt, 1700000000000);
  assertEquals(bcrypt.compareSync("cid_1700000000000", atob(sign)), true);
});

import { parseSyncBody } from "../_shared/b2b.ts";

Deno.test("발주 사이트 직거래 주문 → b2b_sales 행", () => {
  const ok = parseSyncBody({ order_no: "직거래1729500000000_abc", order_date: "2026-10-21", business: "그로븐", client: "김철수", item: "깐마늘", qty: 1, sales: 300000, buy: 260000 });
  assertEquals(ok, { source_ref: "직거래1729500000000_abc", sale_date: "2026-10-21", business: "그로븐", client: "김**", item: "깐마늘", qty: 1, sales: 300000, buy: 260000 });
  const noBuy = parseSyncBody({ order_no: "직거래1", order_date: "2026-10-21", business: "옐로우브릿지", item: "박대", qty: 2, sales: 1000 });
  assertEquals(typeof noBuy === "object" && noBuy.buy, null);
  assertEquals(typeof parseSyncBody({ order_no: "abc", order_date: "2026-10-21", business: "그로븐", item: "x", qty: 1, sales: 1 }), "string");
  assertEquals(typeof parseSyncBody({ order_no: "직거래1", order_date: "2026-10-21", business: "디네트", item: "x", qty: 1, sales: 1 }), "string");
});

import { parseReportBody } from "../_shared/report.ts";

Deno.test("매출 보고 스냅샷 → 숫자만 남기고 개인정보는 버림", () => {
  const r = parseReportBody({
    status: "confirmed",
    snapshot: {
      date: "2026-10-21", totalSales: 1128220, totalCnt: 26, adTotal: 0,
      profitRows: [{ brand: "그로븐", isB2B: false, item: "깐마늘", option: "20kg", count: 2, sales: 317980, purchase: 260000, fee: 38158, vat: 0, profit: 19822, orderDetail: [{ recv_name: "김철수" }] }],
      grAgg: { platMap: { 쿠팡: { count: 2, sales: 317980, comp: { x: 1 } } } },
    },
  });
  if (typeof r === "string") throw new Error(r);
  assertEquals(r.status, "confirmed");
  assertEquals(r.data.rows[0].profit, 19822);
  assertEquals("orderDetail" in r.data.rows[0], false);
  assertEquals(r.data.plat["그로븐"]["쿠팡"], { count: 2, sales: 317980 });
  assertEquals(typeof parseReportBody({ status: "x", snapshot: {} }), "string");
  assertEquals(typeof parseReportBody({ status: "draft", snapshot: { date: "2026/10/21", profitRows: [] } }), "string");
});
