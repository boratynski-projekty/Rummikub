// Supabase Edge Function: wysyła Web Push do zaproszonego gracza.
// Sekrety (ustaw: supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są wstrzykiwane automatycznie.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails("mailto:admin@rummikub.app", VAPID_PUBLIC, VAPID_PRIVATE);

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { toUserId, title, body, url } = await req.json();
    if (!toUserId) return new Response(JSON.stringify({ error: "toUserId required" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });

    const { data: subs } = await supa.from("push_subscriptions").select("endpoint, subscription").eq("user_id", toUserId);
    const payload = JSON.stringify({ title: title || "Rummikub", body: body || "", url: url || "/app" });

    await Promise.all((subs || []).map(async (row: any) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (e: any) {
        // usuń nieaktualne subskrypcje
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await supa.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        }
      }
    }));

    return new Response(JSON.stringify({ ok: true, sent: (subs || []).length }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
});
