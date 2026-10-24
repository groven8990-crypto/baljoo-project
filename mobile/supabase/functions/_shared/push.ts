// 폰으로 웹 푸시 보내기 (VAPID)
// 필요한 비밀값: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(예: mailto:담당자메일)
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { secret } from "./types.ts";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(secret("VAPID_SUBJECT"), secret("VAPID_PUBLIC_KEY"), secret("VAPID_PRIVATE_KEY"));
  configured = true;
}

// pref 가 켜진 관리자·실무 팀원 폰 전체에 보냅니다. 만료된 구독은 지웁니다.
export async function pushToStaff(db: SupabaseClient, pref: string, msg: PushMessage): Promise<number> {
  configure();
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, prefs, members!inner(role)")
    .in("members.role", ["admin", "staff"]);
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
