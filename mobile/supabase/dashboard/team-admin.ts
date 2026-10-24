// Supabase 대시보드 → Edge Functions → Deploy a new function → Via Editor 에 붙여 넣기 (이름 team-admin — 함수가 로그인 토큰을 직접 확인하므로 Verify JWT 는 꺼도 됨)
// 폰 앱 설정 탭의 '팀원 관리' — 담당자(admin)만 부를 수 있습니다.
// 로그인 토큰(Authorization)으로 부른 사람이 담당자인지 확인한 뒤, 서버 권한으로 계정을 만들거나 바꿉니다.
//   { action: "list" }                                   → 팀원 목록 (이메일 포함)
//   { action: "add", name, email, role }                 → 계정 생성 + 임시 비밀번호
//   { action: "role", user_id, role }                    → 권한 변경
//   { action: "reset", user_id }                         → 임시 비밀번호 재발급
//   { action: "remove", user_id }                        → 계정 삭제
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
function secret(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`비밀값 ${name} 이(가) 설정되지 않았습니다`);
  return v;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "staff", "viewer"];

// 헷갈리는 글자(0/o, 1/l/i)를 뺀 임시 비밀번호
export function tempPassword(): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "Gv" + Array.from(b, (x) => a[x % a.length]).join("") + "!";
}

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return reply({ error: "로그인이 필요합니다" }, 401);
  const { data: me } = await db.from("members").select("role").eq("user_id", who.user.id).maybeSingle();
  if (me?.role !== "admin") return reply({ error: "담당자만 할 수 있습니다" }, 403);

  const b = await req.json().catch(() => ({})) as Record<string, string>;
  const self = b.user_id === who.user.id;

  if (b.action === "list") {
    const [{ data: members }, { data: users }] = await Promise.all([
      db.from("members").select("user_id, name, role, created_at").order("created_at"),
      db.auth.admin.listUsers({ perPage: 200 }),
    ]);
    const email = new Map((users?.users ?? []).map((u) => [u.id, u.email]));
    return reply((members ?? []).map((m) => ({ ...m, email: email.get(m.user_id) ?? "" })));
  }

  if (b.action === "add") {
    const name = String(b.name ?? "").trim();
    const mail = String(b.email ?? "").trim().toLowerCase();
    if (!name || !/^\S+@\S+\.\S+$/.test(mail) || !ROLES.includes(b.role)) return reply({ error: "이름 · 이메일 · 권한을 확인해 주세요" }, 400);
    const password = tempPassword();
    const { data, error } = await db.auth.admin.createUser({ email: mail, password, email_confirm: true });
    if (error) return reply({ error: /already/i.test(error.message) ? "이미 등록된 이메일입니다" : error.message }, 400);
    const { error: e2 } = await db.from("members").insert({ user_id: data.user.id, name, role: b.role });
    if (e2) return reply({ error: e2.message }, 500);
    return reply({ ok: true, email: mail, password });
  }

  if (b.action === "role") {
    if (!ROLES.includes(b.role)) return reply({ error: "권한 값이 올바르지 않습니다" }, 400);
    if (self && b.role !== "admin") return reply({ error: "내 권한은 내릴 수 없습니다" }, 400);
    const { error } = await db.from("members").update({ role: b.role }).eq("user_id", b.user_id);
    return error ? reply({ error: error.message }, 500) : reply({ ok: true });
  }

  if (b.action === "reset") {
    const password = tempPassword();
    const { error } = await db.auth.admin.updateUserById(b.user_id, { password });
    return error ? reply({ error: error.message }, 500) : reply({ ok: true, password });
  }

  if (b.action === "remove") {
    if (self) return reply({ error: "내 계정은 지울 수 없습니다" }, 400);
    const { error } = await db.auth.admin.deleteUser(b.user_id); // members · 푸시 구독은 cascade 로 같이 지워짐
    return error ? reply({ error: error.message }, 500) : reply({ ok: true });
  }

  return reply({ error: "알 수 없는 요청" }, 400);
});
