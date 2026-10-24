// 폰으로 웹 푸시 보내기 (VAPID)
// 필요한 비밀값: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(예: mailto:담당자메일) — Secrets 또는 app_secrets
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { appSecret } from "./types.ts";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let configured = false;
async function configure(db: SupabaseClient) {
  if (configured) return;
  const [subject, pub, priv] = await Promise.all(
    ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].map((n) => appSecret(db, n)),
  );
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

// pref 가 켜진 팀원(담당자 · 실무 · 보기 전용) 폰 전체에 보냅니다. 만료된 구독은 지웁니다.
export async function pushToMembers(db: SupabaseClient, pref: string, msg: PushMessage): Promise<number> {
  await configure(db);
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, prefs, members!inner(role)");
  if (error) throw error;
  let sent = 0;
  for (const s of subs ?? []) {
    if (s.prefs?.[pref] === false) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { TTL: 3600 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("푸시 실패", code, (e as Error).message);
    }
  }
  return sent;
}
