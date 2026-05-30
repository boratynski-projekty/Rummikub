"use client";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }
  return (
    <div className="view login-bg">
      <div className="card">
        <div className="bigtiles">
          <div className="t" style={{ color: "var(--pomaranczowy)" }}>7</div>
          <div className="t" style={{ color: "var(--czerwony)" }}>7</div>
          <div className="t" style={{ color: "var(--blekitny)" }}>7</div>
          <div className="t" style={{ color: "var(--czarny)" }}>★</div>
        </div>
        <div className="logo" style={{ fontSize: 26 }}><span>RUM</span><span>MI</span><span>KUB</span></div>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "10px 0 0" }}>Online multiplayer · graj ze znajomymi</p>
        <button className="gbtn" onClick={signIn}>
          <svg style={{ width: 18, height: 18 }} viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.5 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6c1.9-5.6 7.1-9.8 13.7-9.8z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.8-9.9 6.8-17.4z"/><path fill="#FBBC05" d="M10.3 28.3c-.5-1.4-.7-2.9-.7-4.3s.3-2.9.7-4.3l-7.8-6C.9 16.9 0 20.3 0 24s.9 7.1 2.5 10.3l7.8-6z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.4-5.7c-2 1.4-4.7 2.3-7.6 2.3-6.6 0-12.2-4.5-14.2-10.5l-7.8 6C6.4 42.6 14.6 48 24 48z"/></svg>
          Zaloguj się przez Google
        </button>
        <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 14 }}>Logowanie przez Twój projekt Supabase</p>
      </div>
    </div>
  );
}
