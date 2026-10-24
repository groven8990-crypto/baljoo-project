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
