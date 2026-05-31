"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, GameTable, Seat, ChatMessage, Status } from "@/lib/types";

const COLORS = ["pomaranczowy", "czerwony", "blekitny", "czarny"];
const AVCOL: Record<string, string> = {
  pomaranczowy: "var(--pomaranczowy)", czerwony: "var(--czerwony)", blekitny: "var(--blekitny)", czarny: "var(--czarny)",
};
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const timeLabel = (t: string) => (t === "none" ? "bez limitu" : t + "s/runda");

export default function GameApp({ userId }: { userId: string }) {
  const supabase = useRef(createClient()).current;
  const [view, setView] = useState<"loading" | "lobby" | "room" | "game">("loading");
  const [me, setMe] = useState<Profile | null>(null);
  const meRef = useRef<Profile | null>(null);
  const statusMode = useRef<"auto" | "inv">("auto");
  const inactivityTimer = useRef<any>(null);
  const [friends, setFriends] = useState<(Profile & { reqId?: string })[]>([]);
  const friendsRef = useRef<typeof friends>([]);
  const [requests, setRequests] = useState<{ id: string; from: Profile }[]>([]);
  const [tables, setTables] = useState<GameTable[]>([]);
  const tablesRef = useRef<GameTable[]>([]);
  const [myInvites, setMyInvites] = useState<string[]>([]);
  const myInvitesRef = useRef<string[]>([]);
  const [toastMsg, setToastMsg] = useState("");
  const [confirmState, setConfirmState] = useState<{ title: string; msg: string; onYes: () => void } | null>(null);
  const [invitePopup, setInvitePopup] = useState<GameTable | null>(null);
  const popupShown = useRef<Set<string>>(new Set());

  // room
  const [room, setRoom] = useState<{ table: GameTable; iAmOwner: boolean; seats: Seat[] } | null>(null);
  const roomRef = useRef<typeof room>(null);
  const roomChans = useRef<any[]>([]);
  const baseChans = useRef<any[]>([]);

  // chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const chatOpenRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [atTableOpen, setAtTableOpen] = useState(false);
  const [endBanner, setEndBanner] = useState<{ won: boolean } | null>(null);
  const [entryInfo, setEntryInfo] = useState<{ points: number; canClear: boolean; complete: boolean } | null>(null);
  const [installVisible, setInstallVisible] = useState(false);
  const [installHint, setInstallHint] = useState("Dodaj na ekran główny telefonu");
  const deferredPrompt = useRef<any>(null);

  const toast = useCallback((m: string) => { setToastMsg(m); window.clearTimeout((toast as any)._t); (toast as any)._t = window.setTimeout(() => setToastMsg(""), 2200); }, []);

  /* ===== ŁADOWANIE PROFILU ===== */
  useEffect(() => {
    let active = true;
    (async () => {
      let prof = await fetchProfile(userId);
      for (let i = 0; i < 5 && !prof; i++) { await new Promise((r) => setTimeout(r, 400)); prof = await fetchProfile(userId); }
      if (!active) return;
      if (!prof) { toast("Nie udało się wczytać profilu"); return; }
      meRef.current = prof; setMe(prof);
      if (prof.status === "inv") statusMode.current = "inv";
      else { statusMode.current = "auto"; broadcastStatus("on"); }
      await Promise.all([loadFriends(), loadRequests(), loadTables()]);
      subBase();
      setView("lobby");
    })();
    return () => { active = true; cleanupAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pokaż popup zaproszenia gdy zmieni się lista zaproszeń / znajomych / widok
  useEffect(() => {
    if (view === "lobby") checkInvitePopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myInvites, friends, view]);

  async function fetchProfile(id: string): Promise<Profile | null> {
    const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    return (data as Profile) ?? null;
  }

  /* ===== ZNAJOMI ===== */
  const loadFriends = useCallback(async () => {
    const uid = meRef.current!.id;
    const { data } = await supabase.from("friend_requests").select("*").eq("status", "accepted").or(`from_user.eq.${uid},to_user.eq.${uid}`);
    const rows = data || [];
    const ids = rows.map((r: any) => (r.from_user === uid ? r.to_user : r.from_user));
    let list: (Profile & { reqId?: string })[] = [];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,nick,code,avatar_url,status,wins,games,last_seen").in("id", ids);
      list = (profs || []).map((p: any) => ({ ...p, reqId: (rows.find((r: any) => r.from_user === p.id || r.to_user === p.id) || {}).id }));
    }
    friendsRef.current = list; setFriends(list);
  }, [supabase]);

  const loadRequests = useCallback(async () => {
    const uid = meRef.current!.id;
    const { data } = await supabase.from("friend_requests").select("*").eq("to_user", uid).eq("status", "pending");
    const reqs = data || [];
    if (!reqs.length) { setRequests([]); return; }
    const { data: profs } = await supabase.from("profiles").select("id,nick,code,avatar_url,status,wins,games,last_seen").in("id", reqs.map((r: any) => r.from_user));
    setRequests(reqs.map((r: any) => ({ id: r.id, from: (profs || []).find((p: any) => p.id === r.from_user) as Profile })).filter((x: any) => x.from));
  }, [supabase]);

  async function addFriend() {
    const code = (el("friendIdInput") as HTMLInputElement).value.trim().toUpperCase();
    if (!code) return;
    if (code === meRef.current!.code) return toast("To Twój własny kod 🙂");
    const { data: prof } = await supabase.from("profiles").select("id,nick").eq("code", code).maybeSingle();
    if (!prof) return toast("Nie znaleziono gracza o tym kodzie");
    const { error } = await supabase.from("friend_requests").insert({ from_user: meRef.current!.id, to_user: (prof as any).id, status: "pending" });
    if (error) return toast(error.code === "23505" ? "Zaproszenie już istnieje" : "Błąd: " + error.message);
    (el("friendIdInput") as HTMLInputElement).value = "";
    toast("Wysłano zaproszenie do " + (prof as any).nick);
  }
  function removeFriend(reqId: string, nick: string) {
    setConfirmState({ title: "Usunąć znajomego?", msg: `Czy na pewno usunąć ${nick} z listy znajomych?`, onYes: async () => { await supabase.from("friend_requests").delete().eq("id", reqId); await loadFriends(); toast("Usunięto znajomego"); } });
  }
  async function acceptReq(id: string) { await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", id); await loadRequests(); await loadFriends(); toast("Dodano do znajomych"); }
  async function declineReq(id: string) { await supabase.from("friend_requests").delete().eq("id", id); await loadRequests(); toast("Odrzucono"); }

  /* ===== STOŁY ===== */
  const loadTables = useCallback(async () => {
    const { data } = await supabase.from("game_tables").select("*").neq("status", "closed").order("created_at", { ascending: false });
    tablesRef.current = (data as GameTable[]) || []; setTables(tablesRef.current);
    const { data: inv } = await supabase.from("table_invites").select("table_id").eq("user_id", meRef.current!.id);
    myInvitesRef.current = (inv || []).map((r: any) => r.table_id); setMyInvites(myInvitesRef.current);
  }, [supabase]);

  const checkInvitePopup = useCallback(() => {
    if (!friendsRef.current.length) return;
    const uid = meRef.current!.id;
    const pend = tablesRef.current.find((t) => t.host !== uid && t.status === "waiting" && myInvitesRef.current.includes(t.id) && !popupShown.current.has(t.id));
    if (!pend) return;
    popupShown.current.add(pend.id);
    setInvitePopup(pend);
  }, []);

  function subBase() {
    const uid = meRef.current!.id;
    const fr = supabase.channel("fr-" + uid).on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => { loadRequests(); loadFriends(); }).subscribe();
    const tb = supabase.channel("tables-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_tables" }, () => loadTables())
      .on("postgres_changes", { event: "*", schema: "public", table: "table_invites", filter: `user_id=eq.${uid}` }, () => { loadTables().then(checkInvitePopup); })
      .subscribe();
    const pr = supabase.channel("profiles-" + uid)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, () => { loadFriends(); if (roomRef.current) refreshRoom(); })
      .subscribe();
    baseChans.current = [fr, tb, pr];
  }

  /* ===== PROFIL: nick / status / avatar / wyloguj ===== */
  async function saveNick() {
    const v = (el("nickInput") as HTMLInputElement).value.trim(); if (!v) return toast("Nick nie może być pusty");
    const { error } = await supabase.from("profiles").update({ nick: v }).eq("id", meRef.current!.id);
    if (error) return toast("Błąd: " + error.message);
    const np = { ...meRef.current!, nick: v }; meRef.current = np; setMe(np); toast("Zapisano nick");
  }
  function broadcastStatus(s: Status) {
    if (!meRef.current) return;
    if (meRef.current.status === s) return;
    const np = { ...meRef.current, status: s }; meRef.current = np; setMe(np);
    supabase.from("profiles").update({ status: s, last_seen: new Date().toISOString() }).eq("id", np.id);
  }
  // efektywny status z uwzględnieniem aktywności (brak heartbeat > 65s => offline)
  function displayStatus(p: any): Status {
    if (!p) return "off";
    if (p.status === "inv") return "inv";
    if (p.status === "off") return "off";
    if (p.last_seen && Date.now() - new Date(p.last_seen).getTime() > 65000) return "off";
    return (p.status as Status) || "off";
  }
  function setStatusMode(mode: "auto" | "inv") {
    statusMode.current = mode;
    if (mode === "inv") broadcastStatus("inv");
    else { broadcastStatus("on"); resetInactivity(); }
  }
  function resetInactivity() {
    clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => { if (statusMode.current === "auto") broadcastStatus("away"); }, 60000);
  }
  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast("Plik za duży (max 3 MB)");
    toast("Wgrywam avatar…");
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${meRef.current!.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) return toast("Błąd uploadu: " + error.message);
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", meRef.current!.id);
    const np = { ...meRef.current!, avatar_url: data.publicUrl }; meRef.current = np; setMe(np); toast("Avatar zmieniony ✓");
  }
  async function logout() { cleanupAll(); await supabase.auth.signOut(); location.href = "/login"; }

  /* ===== TWORZENIE STOŁU ===== */
  const [createVis, setCreateVis] = useState<"public" | "private">("public");
  const [createTime, setCreateTime] = useState<"none" | "30" | "60">("none");
  const [invited, setInvited] = useState<Set<string>>(new Set());
  async function openCreate() {
    const { data } = await supabase.from("game_tables").select("id").eq("host", meRef.current!.id).neq("status", "closed");
    if (data && data.length) return toast("Masz już stół — zamknij go, by utworzyć nowy");
    setCreateVis("public"); setCreateTime("none"); setInvited(new Set()); setCreateOpen(true);
  }
  async function confirmCreate() {
    const name = (el("tName") as HTMLInputElement).value.trim() || ("Stół " + meRef.current!.nick);
    const { data: t, error } = await supabase.from("game_tables").insert({ name, visibility: createVis, time_mode: createTime, host: meRef.current!.id, status: "waiting" }).select().single();
    if (error) return toast("Błąd: " + error.message);
    await supabase.from("table_members").insert({ table_id: (t as any).id, user_id: meRef.current!.id, ready: false });
    if (createVis === "private" && invited.size) await supabase.from("table_invites").insert([...invited].map((uid) => ({ table_id: (t as any).id, user_id: uid })));
    setCreateOpen(false); enterRoom((t as any).id);
  }

  /* ===== POCZEKALNIA ===== */
  async function enterRoom(tableId: string) {
    const { data: t } = await supabase.from("game_tables").select("*").eq("id", tableId).maybeSingle();
    if (!t) return toast("Stół nie istnieje");
    const { data: ban } = await supabase.from("table_bans").select("user_id").eq("table_id", tableId).eq("user_id", meRef.current!.id).maybeSingle();
    if (ban) return toast("Nie możesz dołączyć — zostałeś wyrzucony na stałe");
    await supabase.from("table_members").upsert({ table_id: tableId, user_id: meRef.current!.id, ready: false }, { onConflict: "table_id,user_id" });
    const r = { table: t as GameTable, iAmOwner: (t as GameTable).host === meRef.current!.id, seats: [] as Seat[] };
    roomRef.current = r; setRoom(r);
    setUnread(0); setChatMsgs([]);
    setView("room");
    await refreshRoom();
    subRoom(tableId); subChat(tableId);
    if ((t as GameTable).status === "playing") startGame();
  }
  async function refreshRoom() {
    const r = roomRef.current; if (!r) return;
    const { data: mem } = await supabase.from("table_members").select("*").eq("table_id", r.table.id);
    const ids = (mem || []).map((m: any) => m.user_id);
    const { data: profs } = ids.length ? await supabase.from("profiles").select("id,nick,code,avatar_url,status,wins,games,last_seen").in("id", ids) : { data: [] };
    const uid = meRef.current!.id;
    const seats: Seat[] = (mem || []).map((m: any) => { const p: any = (profs || []).find((x: any) => x.id === m.user_id) || { nick: "?" }; return { ...p, id: m.user_id, ready: m.ready, owner: m.user_id === r.table.host, me: m.user_id === uid }; });
    const nr = { ...r, seats }; roomRef.current = nr; setRoom(nr);
    if (r.iAmOwner) maybeStart(seats);
  }
  async function maybeStart(seats: Seat[]) {
    const r = roomRef.current; if (!r || !r.iAmOwner || r.table.status === "playing") return;
    if (seats.length >= 2 && seats.every((s) => s.ready)) await supabase.from("game_tables").update({ status: "playing" }).eq("id", r.table.id);
  }
  async function toggleReady() {
    const r = roomRef.current!; const meS = r.seats.find((s) => s.me); const nv = !(meS && meS.ready);
    await supabase.from("table_members").update({ ready: nv }).eq("table_id", r.table.id).eq("user_id", meRef.current!.id);
  }
  async function kick(id: string, permanent: boolean) {
    const r = roomRef.current!;
    if (permanent) await supabase.from("table_bans").insert({ table_id: r.table.id, user_id: id });
    await supabase.from("table_members").delete().eq("table_id", r.table.id).eq("user_id", id);
    toast(permanent ? "Wyrzucony na stałe" : "Wyrzucony (może wrócić)");
  }
  function subRoom(tableId: string) {
    const uid = meRef.current!.id;
    const ch = supabase.channel("room-" + tableId)
      .on("postgres_changes", { event: "*", schema: "public", table: "table_members", filter: `table_id=eq.${tableId}` }, async () => {
        const { data: still } = await supabase.from("table_members").select("user_id").eq("table_id", tableId).eq("user_id", uid).maybeSingle();
        if (!still) { toast("Zostałeś usunięty ze stołu"); leaveRoomCleanup(); setView("lobby"); return; }
        await refreshRoom();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_tables", filter: `id=eq.${tableId}` }, (payload: any) => {
        const r = roomRef.current; if (!r) return; const nr = { ...r, table: payload.new }; roomRef.current = nr; setRoom(nr);
        if (payload.new.status === "playing" && view !== "game") startGame();
        if (payload.new.status === "closed") { toast("Stół zamknięty"); leaveRoomCleanup(); setView("lobby"); }
        if (payload.new.status === "waiting") { stopTimer(); setView("room"); refreshRoom(); }
      })
      .subscribe();
    roomChans.current.push(ch);
  }
  function leaveRoomCleanup() { roomChans.current.forEach((c) => supabase.removeChannel(c)); roomChans.current = []; roomRef.current = null; setRoom(null); }
  async function leaveRoom() { const r = roomRef.current; if (r && !r.iAmOwner) await supabase.from("table_members").delete().eq("table_id", r.table.id).eq("user_id", meRef.current!.id); leaveRoomCleanup(); setView("lobby"); loadTables(); }
  async function closeTable() { const r = roomRef.current!; await supabase.from("game_tables").update({ status: "closed" }).eq("id", r.table.id); leaveRoomCleanup(); toast("Stół zamknięty"); setView("lobby"); }
  async function inviteAtTable(uid: string) { await supabase.from("table_invites").upsert({ table_id: roomRef.current!.table.id, user_id: uid }, { onConflict: "table_id,user_id" }); setAtTableOpen(false); toast("Zaproszono znajomego"); }

  /* ===== CZAT ===== */
  function subChat(tableId: string) {
    setChatMsgs([]);
    supabase.from("messages").select("*").eq("table_id", tableId).order("created_at").then(({ data }) => setChatMsgs((data as ChatMessage[]) || []));
    const ch = supabase.channel("chat-" + tableId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `table_id=eq.${tableId}` }, (payload: any) => {
        setChatMsgs((prev) => [...prev, payload.new]);
        if (!chatOpenRef.current && payload.new.user_id !== meRef.current!.id) setUnread((u) => u + 1);
      })
      .subscribe();
    roomChans.current.push(ch);
  }
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const inp = el("chatinput") as HTMLInputElement; const body = inp.value.trim(); const r = roomRef.current; if (!body || !r) return;
    inp.value = "";
    const { error } = await supabase.from("messages").insert({ table_id: r.table.id, user_id: meRef.current!.id, nick: meRef.current!.nick, body });
    if (error) toast("Błąd czatu: " + error.message);
  }
  function openChat() { chatOpenRef.current = true; setChatOpen(true); setUnread(0); }
  function closeChat() { chatOpenRef.current = false; setChatOpen(false); }
  useEffect(() => { const log = el("chatlog"); if (log) log.scrollTop = log.scrollHeight; }, [chatMsgs, chatOpen]);

  /* ===== GRA (imperatywny board) ===== */
  const players = useRef<any[]>([]);
  const turn = useRef(0);
  const playedThisTurn = useRef(false);
  const entered = useRef(false); // czy gracz „wszedł do gry" (pierwszy układ min. 30 pkt)
  const roundTime = useRef<number | null>(null);
  const timerInt = useRef<any>(null);
  const tileId = useRef(0);
  const drag = useRef<HTMLElement | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const caret = useRef<HTMLElement | null>(null);
  const fromMeld = useRef<HTMLElement | null>(null);
  const gameState = useRef<any>(null);
  const gameCh = useRef<any>(null);
  const curTurnUid = useRef<string | null>(null);
  const endedFor = useRef<string | null>(null);
  const rackLoaded = useRef(false); // tabliczkę ładujemy z bazy tylko raz (zachowujemy ułożenie gracza)

  function buildDeck() {
    const deck: any[] = [];
    for (let copy = 0; copy < 2; copy++) for (const c of COLORS) for (let n = 1; n <= 13; n++) deck.push({ n, c, j: false });
    deck.push({ n: null, c: "czerwony", j: true }); deck.push({ n: null, c: "czarny", j: true });
    for (let i = deck.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [deck[i], deck[k]] = [deck[k], deck[i]]; }
    return deck;
  }
  async function startGame() {
    const r = roomRef.current!; setView("game"); playedThisTurn.current = false; endedFor.current = null; rackLoaded.current = false; setEntryInfo(null);
    let { data: gs } = await supabase.from("game_state").select("*").eq("table_id", r.table.id).maybeSingle();
    if (!gs && r.iAmOwner) {
      const order = r.seats.map((s) => s.id);
      const deck = buildDeck(); const hands: Record<string, any[]> = {}; const ent: Record<string, boolean> = {};
      order.forEach((uid) => { hands[uid] = deck.splice(0, 14); ent[uid] = false; });
      const { data: ins } = await supabase.from("game_state")
        .insert({ table_id: r.table.id, board: [], hands, pool: deck, turn_order: order, turn: order[0], entered: ent, winner: null })
        .select().single();
      gs = ins;
    }
    subGame(r.table.id); setupTimer(r.table.time_mode);
    requestAnimationFrame(() => { if (gameState.current) applyState(gameState.current); else if (gs) applyState(gs); });
  }
  function subGame(tableId: string) {
    if (gameCh.current) supabase.removeChannel(gameCh.current);
    const ch = supabase.channel("game-" + tableId)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state", filter: `table_id=eq.${tableId}` },
        (payload: any) => { if (payload.new) applyState(payload.new); })
      .subscribe();
    gameCh.current = ch; roomChans.current.push(ch);
  }
  function applyState(s: any) {
    gameState.current = s; const myId = meRef.current!.id;
    if (!el("tray")) { requestAnimationFrame(() => applyState(s)); return; }
    turn.current = s.turn === myId ? 0 : 1;
    entered.current = !!(s.entered && s.entered[myId]);
    playedThisTurn.current = false;
    curTurnUid.current = s.turn;
    players.current = [{ nick: meRef.current!.nick, me: true, profile: meRef.current }];
    (s.turn_order || []).forEach((uid: string) => {
      if (uid === myId) return;
      const seat = roomRef.current?.seats.find((x) => x.id === uid);
      players.current.push({ uid, nick: seat?.nick || "Gracz", profile: seat || {}, tiles: (s.hands?.[uid] || []).length, isTurn: s.turn === uid });
    });
    buildBoard(s.board || []);
    if (!rackLoaded.current) { buildRack((s.hands && s.hands[myId]) || []); rackLoaded.current = true; }
    tidy(); syncTurnUI();
    if (s.winner && endedFor.current !== s.winner) { endedFor.current = s.winner; stopTimer(); recordResult(s.winner === myId); setEndBanner({ won: s.winner === myId }); }
  }
  function tray() { return el("tray"); }
  function melds() { return el("melds"); }
  function mkTile(n: number | null, c: string, joker?: boolean) {
    const d = document.createElement("div"); d.className = "tile c-" + c + (joker ? " joker" : ""); d.dataset.id = String(++tileId.current);
    d.textContent = joker ? "★" : String(n); d.dataset.n = n == null ? "" : String(n); d.dataset.c = c; d.dataset.joker = joker ? "1" : ""; attachDrag(d); return d;
  }
  function mkTileObj(t: any) { return mkTile(t.n, t.c, !!t.j); }
  function newMeld() { const e = document.createElement("div"); e.className = "meld"; melds().appendChild(e); return e; }
  function buildBoard(board: any[]) { melds().innerHTML = ""; board.forEach((m: any[]) => { const e = newMeld(); m.forEach((t) => e.appendChild(mkTileObj(t))); }); }
  function buildRack(hand: any[]) { tray().innerHTML = ""; hand.forEach((t) => tray().appendChild(mkTileObj(t))); }
  function serializeBoard() { return [...melds().querySelectorAll(".meld")].map((m) => tilesOf(m).map((t) => ({ n: t.n, c: t.c, j: t.joker }))); }
  function serializeRack() { return [...tray().querySelectorAll<HTMLElement>(".tile")].map((t) => ({ n: t.dataset.n ? +t.dataset.n : null, c: t.dataset.c, j: t.dataset.joker === "1" })); }
  function committedPoints() { return ((gameState.current?.board) || []).reduce((sum: number, m: any[]) => sum + meldPoints(m.map((t) => ({ n: t.n, c: t.c, joker: t.j }))), 0); }
  function tidy() { melds().querySelectorAll(".meld").forEach((m) => { if (!m.querySelector(".tile")) m.remove(); }); el("hint").style.display = melds().querySelector(".meld") ? "none" : "grid"; const c = el("count"); if (c) c.textContent = String(tray().children.length); }
  function tilesOf(m: Element) { return [...m.querySelectorAll<HTMLElement>(".tile")].map((t) => ({ n: t.dataset.n ? +t.dataset.n : null, c: t.dataset.c!, joker: t.dataset.joker === "1" })); }
  function validMeld(arr: { n: number | null; c: string; joker: boolean }[]) {
    if (arr.length <= 1) return true; const real = arr.filter((t) => !t.joker); if (real.length === 0) return true;
    const sameVal = real.every((t) => t.n === real[0].n);
    if (sameVal) { const cols = real.map((t) => t.c); if (new Set(cols).size !== cols.length) return false; return arr.length <= 4; }
    if (!real.every((t) => t.c === real[0].c)) return false; let prev: number | null = null;
    for (const t of arr) { if (t.joker) { if (prev != null) prev++; continue; } if (prev != null && t.n !== prev + 1) return false; prev = t.n; }
    return arr.length <= 13 && arr.every((t) => t.joker || (t.n! >= 1 && t.n! <= 13));
  }
  function attachDrag(tile: HTMLElement) {
    tile.addEventListener("pointerdown", (e) => { if (turn.current !== 0 && !tile.closest(".tray")) return; e.preventDefault(); drag.current = tile; fromMeld.current = tile.closest(".meld"); tile.classList.add("dragging"); const g = tile.cloneNode(true) as HTMLElement; g.classList.add("ghosttile"); g.classList.remove("dragging"); document.body.appendChild(g); ghost.current = g; const c = document.createElement("div"); c.className = "caret"; caret.current = c; tile.setPointerCapture(e.pointerId); moveGhost(e); });
    tile.addEventListener("pointermove", (e) => { if (drag.current) moveGhost(e); });
    tile.addEventListener("pointerup", (e) => { if (drag.current) drop(e); });
    tile.addEventListener("pointercancel", (e) => { if (drag.current) drop(e); });
  }
  function beforeIn(cont: Element, x: number) { const tiles = [...cont.querySelectorAll<HTMLElement>(".tile")].filter((t) => t !== drag.current); for (const t of tiles) { const r = t.getBoundingClientRect(); if (x < r.left + r.width / 2) return t; } return null; }
  function locate(x: number, y: number): { cont: any; before: HTMLElement | null } | null {
    const elem = document.elementFromPoint(x, y); if (!elem) return null; let cont: any = elem.closest(".tray") ? tray() : null;
    if (turn.current !== 0) return cont ? { cont, before: beforeIn(cont, x) } : null;
    if (!cont) { const m = elem.closest(".meld"); if (m) cont = m; } if (!cont && elem.closest(".gametable")) cont = "NEW"; if (!cont) return null;
    if (cont === "NEW") return { cont: "NEW", before: null }; return { cont, before: beforeIn(cont, x) };
  }
  function moveGhost(e: PointerEvent) { const g = ghost.current!; g.style.left = e.clientX + "px"; g.style.top = e.clientY + "px"; const loc = locate(e.clientX, e.clientY); const c = caret.current!; if (c.parentNode) c.remove(); if (loc && loc.cont !== "NEW") { loc.before ? loc.cont.insertBefore(c, loc.before) : loc.cont.appendChild(c); } }
  function drop(e: PointerEvent) {
    const loc = locate(e.clientX, e.clientY); const d = drag.current!; d.classList.remove("dragging"); const c = caret.current!; if (c.parentNode) c.remove();
    if (loc) { let cont: any = loc.cont; if (cont === "NEW") cont = newMeld(); if (loc.before && loc.before !== c) cont.insertBefore(d, loc.before); else cont.appendChild(d);
      if (cont.classList && cont.classList.contains("meld")) { if (!validMeld(tilesOf(cont))) { cont.classList.add("bad"); const ref = cont; setTimeout(() => ref.classList.remove("bad"), 350); tray().appendChild(d); } else if (fromMeld.current !== cont) playedThisTurn.current = true; } }
    tidy(); syncTurnUI();
    ghost.current?.remove(); ghost.current = null; drag.current = null; caret.current = null; fromMeld.current = null;
  }
  function renderOpps() {
    const box = el("opponents"); if (!box) return;
    box.innerHTML = players.current.slice(1).map((o: any) => { const p = o.profile || {};
      const av = p.avatar_url ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : esc(o.nick).slice(0, 2).toUpperCase();
      return `<div class="opp ${o.isTurn ? "turn" : ""}"><div class="avatar" style="width:34px;height:34px;background:${AVCOL[COLORS[(p.code ? p.code.charCodeAt(3) : 0) % 4]]}">${av}<span class="dot ${displayStatus(p)}"></span></div><div class="meta"><div class="nick">${esc(o.nick)}</div><div class="tiles">${o.tiles} klocków</div></div></div>`; }).join("");
  }
  function meldPoints(arr: { n: number | null; c: string; joker: boolean }[]) {
    const real = arr.filter((t) => !t.joker); if (!real.length) return 0;
    const sameVal = real.every((t) => t.n === real[0].n);
    if (sameVal) return arr.length * (real[0].n as number); // grupa: każdy klocek = wartość (joker też)
    let prev: number | null = null, sum = 0;
    for (const t of arr) { if (t.joker) { if (prev != null) { prev++; sum += prev; } } else { sum += t.n as number; prev = t.n; } }
    return sum;
  }
  function boardState() {
    const ms = [...melds().querySelectorAll(".meld")];
    const tiles = ms.reduce((n, m) => n + m.querySelectorAll(".tile").length, 0);
    const complete = ms.length > 0 && ms.every((m) => { const a = tilesOf(m); return a.length >= 3 && validMeld(a); });
    const points = ms.reduce((s, m) => s + meldPoints(tilesOf(m)), 0);
    return { tiles, complete, points, count: ms.length };
  }
  function syncTurnUI() {
    const my = turn.current === 0; const yl = el("youlabel"); if (!yl) return;
    yl.classList.toggle("off", !my); yl.innerHTML = (my ? "Twoja kolej" : "Czekaj na swój ruch") + ' · <span id="count">' + tray().children.length + "</span> klocków";
    (el("draw") as HTMLButtonElement).disabled = !my; (el("sort") as HTMLButtonElement).disabled = false;
    const b = boardState(); const newPts = b.points - committedPoints();
    let canEnd = my && playedThisTurn.current && b.complete;
    if (my && !entered.current) canEnd = canEnd && newPts >= 30;
    (el("endturn") as HTMLButtonElement).disabled = !canEnd;
    setEntryInfo(my && !entered.current ? { points: newPts, canClear: playedThisTurn.current, complete: b.complete } : null);
    renderOpps(); resetRoundTimer();
  }
  async function commitTurn() {
    const s = gameState.current; if (!s) return; const myId = meRef.current!.id;
    if (s.turn !== myId) return;
    const b = boardState();
    if (b.count === 0 || !b.complete) { toast("Każdy układ musi mieć min. 3 klocki i być poprawny"); return; }
    if (!entered.current) { const newPts = b.points - committedPoints(); if (newPts < 30) { toast(`Aby wejść do gry potrzebujesz min. 30 pkt (masz ${newPts})`); return; } }
    const newHand = serializeRack();
    const hands = { ...s.hands, [myId]: newHand };
    const ent = { ...s.entered, [myId]: true };
    const order: string[] = s.turn_order; const nextUid = order[(order.indexOf(myId) + 1) % order.length];
    const winner = newHand.length === 0 ? myId : (s.winner || null);
    await supabase.from("game_state").update({ board: serializeBoard(), hands, entered: ent, turn: nextUid, winner }).eq("table_id", s.table_id);
  }
  function clearTilesToRack() {
    const s = gameState.current; if (!s) return; const myId = meRef.current!.id;
    buildBoard(s.board || []); buildRack(s.hands[myId] || []);
    playedThisTurn.current = false; tidy(); syncTurnUI(); toast("Klocki wróciły na tabliczkę");
  }
  async function drawTile() {
    const s = gameState.current; if (!s) return; const myId = meRef.current!.id; if (s.turn !== myId) return;
    const pool = [...(s.pool || [])]; let hands = s.hands;
    if (pool.length) { const t = pool.pop(); hands = { ...s.hands, [myId]: [...(s.hands[myId] || []), t] }; tray().appendChild(mkTileObj(t)); tidy(); } else toast("Brak klocków w puli");
    const order: string[] = s.turn_order; const nextUid = order[(order.indexOf(myId) + 1) % order.length];
    await supabase.from("game_state").update({ pool, hands, turn: nextUid }).eq("table_id", s.table_id);
  }
  function setupTimer(mode: string) { stopTimer(); const tEl = el("timer"); if (mode === "none") { roundTime.current = null; tEl.textContent = "⏱ bez limitu"; tEl.classList.remove("low"); return; } roundTime.current = +mode; let s = roundTime.current; const tick = () => { tEl.textContent = "⏱ 0:" + String(s).padStart(2, "0"); tEl.classList.toggle("low", s <= 10); if (s <= 0) { if (turn.current === 0) drawTile(); return; } s--; }; tick(); timerInt.current = setInterval(tick, 1000); (tEl as any)._reset = () => { s = roundTime.current!; }; }
  function resetRoundTimer() { const tEl = el("timer"); if (tEl && (tEl as any)._reset) (tEl as any)._reset(); }
  function stopTimer() { if (timerInt.current) clearInterval(timerInt.current); timerInt.current = null; }
  function doSort() { const t = tray(); const ts = [...t.children].filter((x) => x.classList.contains("tile")) as HTMLElement[]; ts.sort((a, b) => COLORS.indexOf(a.dataset.c!) - COLORS.indexOf(b.dataset.c!) || (+a.dataset.n! - +b.dataset.n!)); ts.forEach((x) => t.appendChild(x)); }
  async function recordResult(won: boolean) {
    const np = { ...meRef.current! }; if (won) np.wins = (np.wins || 0) + 1; np.games = (np.games || 0) + 1; meRef.current = np; setMe(np);
    await supabase.from("profiles").update({ wins: np.wins, games: np.games }).eq("id", np.id);
  }
  async function hostEnd() {
    stopTimer(); const r = roomRef.current!;
    await supabase.from("game_state").delete().eq("table_id", r.table.id);
    await supabase.from("game_tables").update({ status: "waiting" }).eq("id", r.table.id);
    await supabase.from("table_members").update({ ready: false }).eq("table_id", r.table.id);
    toast("Gra zakończona");
  }

  function cleanupAll() { roomChans.current.forEach((c) => { try { supabase.removeChannel(c); } catch {} }); baseChans.current.forEach((c) => { try { supabase.removeChannel(c); } catch {} }); stopTimer(); }

  /* ===== STATUS oparty na aktywności ===== */
  useEffect(() => {
    const onActivity = () => {
      if (statusMode.current !== "auto") return;
      if (meRef.current && meRef.current.status !== "on") broadcastStatus("on");
      resetInactivity();
    };
    const onVis = () => {
      if (statusMode.current !== "auto") return;
      if (document.visibilityState === "hidden") broadcastStatus("off");
      else { broadcastStatus("on"); resetInactivity(); }
    };
    const onLeave = () => { if (statusMode.current === "auto") broadcastStatus("off"); };
    const evs: (keyof WindowEventMap)[] = ["mousemove", "keydown", "touchstart", "click", "scroll"];
    evs.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onLeave);
    resetInactivity();
    return () => { evs.forEach((ev) => window.removeEventListener(ev, onActivity)); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onLeave); clearTimeout(inactivityTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== HEARTBEAT + ODŚWIEŻANIE statusów / zaproszeń ===== */
  const [, setTick] = useState(0);
  useEffect(() => {
    // heartbeat: dopóki karta widoczna i tryb auto, odświeżaj last_seen
    const hb = setInterval(() => {
      if (meRef.current && statusMode.current === "auto" && document.visibilityState === "visible")
        supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", meRef.current.id);
    }, 25000);
    // re-render co 20s, by przeliczyć „offline po nieaktywności"
    const tick = setInterval(() => setTick((t) => t + 1), 20000);
    return () => { clearInterval(hb); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // polling listy stołów/zaproszeń w lobby (fallback, gdyby realtime nie dochodził)
    if (view !== "lobby") return;
    const iv = setInterval(() => { loadTables(); loadRequests(); }, 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /* ===== PWA ===== */
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const onBip = (e: any) => { e.preventDefault(); deferredPrompt.current = e; if (isMobile && !isStandalone) { setInstallHint("Dodaj na ekran główny telefonu"); setInstallVisible(true); } };
    window.addEventListener("beforeinstallprompt", onBip);
    if (isIOS && !isStandalone) setTimeout(() => { setInstallHint('iPhone: Udostępnij ⬆ → „Dodaj do ekranu początkowego"'); setInstallVisible(true); }, 2500);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  async function doInstall() {
    if (deferredPrompt.current) { deferredPrompt.current.prompt(); await deferredPrompt.current.userChoice; deferredPrompt.current = null; setInstallVisible(false); }
    else toast('iPhone: kliknij „Udostępnij" ⬆ i wybierz „Dodaj do ekranu początkowego"');
  }

  /* ===== RENDER ===== */
  const Avatar = ({ p, size, status }: { p: Partial<Profile> | null; size: number; status?: boolean; onClick?: () => void }) => {
    const bg = AVCOL[COLORS[(p?.code ? p.code.charCodeAt(3) : 0) % 4]] || AVCOL.blekitny;
    return (
      <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: p?.avatar_url ? undefined : bg }}>
        {p?.avatar_url ? <img src={p.avatar_url} alt="" /> : (p?.nick || "?").slice(0, 2).toUpperCase()}
        {status && <span className={"dot " + (p?.status || "on")} />}
      </div>
    );
  };

  const profileById = (id: string): Partial<Profile> => {
    if (me && id === me.id) return me;
    const s = room?.seats.find((x) => x.id === id); if (s) return s;
    const f = friends.find((x) => x.id === id); if (f) return f;
    return {};
  };

  if (view === "loading") return <div className="view login-bg"><div className="logo" style={{ fontSize: 22 }}><span>RUM</span><span>MI</span><span>KUB</span></div></div>;

  const statusLabels: Record<string, string> = { on: "🟢 online", inv: "🟡 niewidoczny", off: "⚪ offline", away: "🟠 zaraz wracam" };
  const uid = me?.id;
  const mine = tables.filter((t) => t.host === uid);
  const invitedT = tables.filter((t) => t.host !== uid && t.visibility === "private" && myInvites.includes(t.id));
  const pub = tables.filter((t) => t.visibility === "public" && t.host !== uid);

  return (
    <>
      {/* LOBBY */}
      {view === "lobby" && me && (
        <div className="view">
          <div className="top">
            <div className="logo"><span>RUM</span><span>MI</span><span>KUB</span></div>
            <div className="me">
              <select className="statussel" value={me.status === "inv" ? "inv" : "on"} onChange={(e) => setStatusMode(e.target.value === "inv" ? "inv" : "auto")}>
                <option value="on">🟢 Online (auto)</option><option value="inv">🟡 Niewidoczny</option>
              </select>
              <Avatar p={me} size={36} status />
            </div>
          </div>
          <div className="wrap">
            <div className="sec">
              <h3>Twój profil</h3>
              <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
                <label style={{ cursor: "pointer" }} title="Zmień avatar"><Avatar p={me} size={60} /><input type="file" accept="image/*" style={{ display: "none" }} onChange={onAvatar} /></label>
                <div className="grow">
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Twój nick — wpisz tutaj, aby go zmienić, i kliknij „Zapisz"</label>
                  <div className="row"><input className="grow" id="nickInput" maxLength={16} defaultValue={me.nick} placeholder="Twój nick" /><button className="btn" onClick={saveNick}>Zapisz</button></div>
                  <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Twój kod:</span>
                    <span className="idtag">{me.code}</span>
                    <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(me.code); toast("Skopiowano kod"); }}>Kopiuj</button>
                    <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={logout}>Wyloguj</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="sec"><h3>Statystyki</h3>
              <div className="stat">
                <div className="b"><div className="n">{me.wins || 0}</div><div className="l">Wygrane</div></div>
                <div className="b"><div className="n">{me.games || 0}</div><div className="l">Rozegrane</div></div>
                <div className="b"><div className="n">{me.games ? Math.round((me.wins / me.games) * 100) : 0}%</div><div className="l">Skuteczność</div></div>
              </div>
            </div>
            {requests.length > 0 && (
              <div className="sec"><h3>Zaproszenia do znajomych</h3>
                {requests.map((r) => (
                  <div className="friend" key={r.id}>
                    <Avatar p={{ ...r.from, status: displayStatus(r.from) }} size={38} status />
                    <div className="grow"><div className="nick">{r.from.nick}</div><div className="sub">{r.from.code} chce Cię dodać</div></div>
                    <button className="btn blue" style={{ padding: "7px 10px", fontSize: 12 }} onClick={() => acceptReq(r.id)}>Akceptuj</button>
                    <button className="btn ghost" style={{ padding: "7px 10px", fontSize: 12 }} onClick={() => declineReq(r.id)}>Odrzuć</button>
                  </div>
                ))}
              </div>
            )}
            <div className="sec"><h3>Znajomi</h3>
              <div className="row" style={{ marginBottom: 12 }}><input className="grow" id="friendIdInput" placeholder="Kod znajomego (np. RK-1042)" /><button className="btn blue" onClick={addFriend}>Dodaj</button></div>
              {friends.length === 0 ? <div className="empty">Brak znajomych. Dodaj kogoś po kodzie powyżej.</div> :
                friends.map((f) => (
                  <div className="friend" key={f.id}>
                    <Avatar p={{ ...f, status: displayStatus(f) }} size={38} status />
                    <div className="grow"><div className="nick">{f.nick}</div><div className="sub">{f.code} · {statusLabels[displayStatus(f)]}</div></div>
                    <button className="btn ghost" style={{ padding: "7px 10px", fontSize: 12 }} onClick={() => removeFriend(f.reqId!, f.nick)}>Usuń</button>
                  </div>
                ))}
            </div>
            <div className="sec"><h3>Stoły</h3>
              <div className="row" style={{ marginBottom: 12 }}><button className="btn grow" onClick={openCreate}>+ Utwórz stół</button></div>
              {(mine.length > 0 || invitedT.length > 0) && <div className="subhead">Twoje i zaproszenia</div>}
              {mine.map((t) => <TableRow key={t.id} t={t} tag="Twój stół" mine onOpen={() => enterRoom(t.id)} />)}
              {invitedT.map((t) => <TableRow key={t.id} t={t} tag="Zaproszenie 🔒" onOpen={() => enterRoom(t.id)} />)}
              <div className="subhead">Publiczne</div>
              {pub.length ? pub.map((t) => <TableRow key={t.id} t={t} tag="Publiczny" onOpen={() => enterRoom(t.id)} />) : <div className="empty">Brak publicznych stołów.</div>}
            </div>
          </div>
        </div>
      )}

      {/* POCZEKALNIA */}
      {view === "room" && room && (
        <div className="view">
          <div className="top">
            <div className="logo" style={{ fontSize: 16 }}>{room.table.name}{room.table.visibility === "private" ? " 🔒" : ""}</div>
            <button className="chatbtn" style={{ marginLeft: "auto" }} onClick={openChat}>💬 Czat{unread > 0 && <span className="badge">{unread}</span>}</button>
            <button className="leave" onClick={leaveRoom}>Opuść</button>
          </div>
          <div className="wrap">
            <div className="sec"><h3>Gracze przy stole</h3>
              {room.seats.map((s) => (
                <div className="seat" key={s.id}>
                  <Avatar p={{ ...s, status: displayStatus(s) }} size={40} status />
                  <div className="grow"><div className="nick">{s.nick} {s.owner && <span className="crown">👑</span>}{s.me && <span className="sub"> (Ty)</span>}</div><div className={s.ready ? "ready" : "waiting"}>{s.ready ? "✓ Gotowy" : "⏳ Czeka…"}</div></div>
                  {room.iAmOwner && !s.me && <SeatMenu onKick={() => kick(s.id, false)} onBan={() => kick(s.id, true)} />}
                </div>
              ))}
              <p className="empty">{room.seats.length} graczy przy stole</p>
            </div>
            {room.iAmOwner && (
              <div className="sec"><h3>Panel właściciela</h3>
                <div className="row" style={{ flexWrap: "wrap" }}><button className="btn ghost" onClick={() => setAtTableOpen(true)}>+ Zaproś znajomego</button><button className="btn red" onClick={closeTable}>Zamknij stół</button></div>
              </div>
            )}
            <div className="sec">
              {room.table.status === "playing" ? (
                <>
                  <button className="btn" style={{ width: "100%" }} onClick={startGame}>▶ Wróć do gry</button>
                  <p className="empty" style={{ textAlign: "center" }}>Gra jest w toku — możesz wrócić do stołu.</p>
                </>
              ) : (
                <>
                  <button className={"btn" + (room.seats.find((s) => s.me)?.ready ? " blue" : "")} style={{ width: "100%" }} onClick={toggleReady}>{room.seats.find((s) => s.me)?.ready ? "✓ Jesteś gotowy (anuluj)" : "Gotowy do startu"}</button>
                  <p className="empty" style={{ textAlign: "center" }}>Gra ruszy, gdy wszyscy będą gotowi.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GRA */}
      {view === "game" && room && (
        <div className="view">
          <div className="gameheader">
            <div className="logo"><span>RUM</span><span>MI</span><span>KUB</span></div>
            <div className="timer" id="timer">⏱ —</div>
            <button className="chatbtn" onClick={openChat}>💬{unread > 0 && <span className="badge">{unread}</span>}</button>
            {room.iAmOwner && <button className="leave" onClick={hostEnd}>Zakończ</button>}
            <button className="leave" onClick={() => { stopTimer(); setView("room"); refreshRoom(); }}>Wyjdź</button>
          </div>
          <div className="opponents" id="opponents" />
          <div className="gametable"><div className="hint" id="hint">Przeciągnij klocki z tabliczki tutaj</div><div className="melds" id="melds" /></div>
          <div className="rack">
            <div className="rackbar">
              <div className="row" style={{ gap: 8 }}><Avatar p={me} size={32} /><div className="you" id="youlabel">Twoja kolej · <span id="count">0</span> klocków</div></div>
              <button className="btn ghost" id="sort" style={{ padding: "8px 12px" }} onClick={doSort}>Sortuj</button>
              <button className="btn" id="draw" style={{ padding: "8px 12px" }} onClick={drawTile}>Dobierz</button>
              <button className="btn blue" id="endturn" style={{ padding: "8px 12px", marginLeft: "auto" }} onClick={commitTurn}>Zakończ turę</button>
            </div>
            {entryInfo && (
              <div className="entrybar">
                <div className="grow">
                  <div style={{ fontWeight: 800, fontSize: 13 }}>⚠ Jeszcze nie wszedłeś do gry</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Wyłóż układy na sumę min. <b>30 pkt</b> (np. 3×9 lub 1-2-3 jednego koloru), potem „Zakończ turę".
                    {" "}Masz teraz: <b style={{ color: entryInfo.points >= 30 && entryInfo.complete ? "#39d353" : "var(--pomaranczowy)" }}>{entryInfo.points} pkt</b>
                    {!entryInfo.complete && entryInfo.canClear ? " (dokończ układy: min. 3 klocki)" : ""}
                  </div>
                </div>
                <button className="btn ghost" disabled={!entryInfo.canClear} onClick={clearTilesToRack} style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>Sprzątnij klocki</button>
              </div>
            )}
            <div className="tray" id="tray" />
          </div>
        </div>
      )}

      {/* CHAT modal */}
      {chatOpen && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) closeChat(); }}>
          <div className="card chatcard">
            <div className="row"><h3 className="logo" style={{ margin: 0 }}>💬 Czat stołu</h3><button className="leave" style={{ marginLeft: "auto" }} onClick={closeChat}>Zamknij</button></div>
            <div className="chatlog" id="chatlog">
              {chatMsgs.map((m) => {
                const mineMsg = m.user_id === uid;
                const p = { ...profileById(m.user_id), nick: m.nick } as Partial<Profile>;
                return (
                  <div key={m.id} className={"msgrow" + (mineMsg ? " mine" : "")}>
                    <Avatar p={p} size={26} />
                    <div className={"msg" + (mineMsg ? " mine" : "")}><div className="who">{m.nick}</div>{m.body}</div>
                  </div>
                );
              })}
            </div>
            <form className="chatform" onSubmit={sendChat}><input className="grow" id="chatinput" placeholder="Napisz wiadomość…" maxLength={300} autoComplete="off" /><button className="btn" type="submit">Wyślij</button></form>
          </div>
        </div>
      )}

      {/* CREATE modal */}
      {createOpen && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <div className="card">
            <h3 style={{ margin: "0 0 14px" }}><span className="logo">Nowy stół</span></h3>
            <div className="field"><label>Nazwa stołu</label><input id="tName" maxLength={24} placeholder="np. Wieczór z ekipą" /></div>
            <div className="field"><label>Widoczność</label><div className="seg">
              <button className={createVis === "public" ? "sel" : ""} onClick={() => setCreateVis("public")}>🌐 Publiczny</button>
              <button className={createVis === "private" ? "sel" : ""} onClick={() => setCreateVis("private")}>🔒 Prywatny</button>
            </div></div>
            <div className="field"><label>Tryb czasu</label><div className="seg">
              {(["none", "30", "60"] as const).map((t) => <button key={t} className={createTime === t ? "sel" : ""} onClick={() => setCreateTime(t)}>{t === "none" ? "Bez limitu" : t + "s/runda"}</button>)}
            </div></div>
            {createVis === "private" && (
              <div className="field"><label>Zaproś znajomych</label>
                {friends.length === 0 ? <div className="empty">Najpierw dodaj znajomych.</div> : friends.map((f) => (
                  <label className="pick" key={f.id}>
                    <Avatar p={{ ...f, status: displayStatus(f) }} size={34} status />
                    <span className="grow" style={{ fontWeight: 600 }}>{f.nick}</span>
                    <input type="checkbox" checked={invited.has(f.id)} onChange={(e) => { const n = new Set(invited); e.target.checked ? n.add(f.id) : n.delete(f.id); setInvited(n); }} />
                  </label>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}><button className="btn ghost grow" onClick={() => setCreateOpen(false)}>Anuluj</button><button className="btn grow" onClick={confirmCreate}>Utwórz</button></div>
          </div>
        </div>
      )}

      {/* AT-TABLE invite */}
      {atTableOpen && room && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setAtTableOpen(false); }}>
          <div className="card">
            <h3 style={{ margin: "0 0 12px" }}><span className="logo">Zaproś znajomego</span></h3>
            {(() => { const avail = friends.filter((f) => !room.seats.some((s) => s.id === f.id)); return avail.length ? avail.map((f) => (
              <div className="friend" key={f.id}><Avatar p={f} size={34} status /><div className="grow"><div className="nick">{f.nick}</div><div className="sub">{f.code}</div></div><button className="btn" style={{ padding: "7px 10px", fontSize: 12 }} onClick={() => inviteAtTable(f.id)}>Zaproś</button></div>
            )) : <div className="empty">Brak znajomych do zaproszenia.</div>; })()}
            <button className="btn ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setAtTableOpen(false)}>Zamknij</button>
          </div>
        </div>
      )}

      {/* INVITE popup */}
      {invitePopup && (
        <div className="modal">
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>📩</div><h3 style={{ margin: "8px 0" }}><span className="logo">Zaproszenie do gry</span></h3>
            <p style={{ color: "var(--muted)" }}><b>{(friends.find((f) => f.id === invitePopup.host) || { nick: "Znajomy" }).nick}</b> zaprasza Cię do „{invitePopup.name}"<br /><span className="sub">{timeLabel(invitePopup.time_mode)} · prywatny</span></p>
            <div className="row" style={{ marginTop: 8 }}><button className="btn ghost grow" onClick={() => { setInvitePopup(null); toast("Zaproszenie odrzucone (stół zostaje na liście)"); }}>Odrzuć</button><button className="btn grow" onClick={() => { const id = invitePopup.id; setInvitePopup(null); enterRoom(id); }}>Dołącz</button></div>
          </div>
        </div>
      )}

      {/* CONFIRM */}
      {confirmState && (
        <div className="modal">
          <div className="card" style={{ textAlign: "center" }}>
            <h3 style={{ margin: "0 0 10px" }}>{confirmState.title}</h3>
            <p style={{ color: "var(--muted)" }}>{confirmState.msg}</p>
            <div className="row" style={{ marginTop: 8 }}><button className="btn ghost grow" onClick={() => setConfirmState(null)}>Anuluj</button><button className="btn red grow" onClick={() => { const f = confirmState.onYes; setConfirmState(null); f(); }}>Usuń</button></div>
          </div>
        </div>
      )}

      {/* END banner */}
      {endBanner && (
        <div className="banner"><div className="card" style={{ textAlign: "center" }}>
          <div className="logo" style={{ fontSize: 22 }}>{endBanner.won ? "🎉 Wygrałeś!" : "Koniec gry"}</div>
          <p style={{ color: "var(--muted)" }}>{endBanner.won ? "Wyłożyłeś wszystkie klocki. Gratulacje!" : ""}</p>
          <button className="btn" onClick={() => { setEndBanner(null); if (roomRef.current) { setView("room"); refreshRoom(); } else setView("lobby"); }}>Wróć do stołu</button>
        </div></div>
      )}

      {/* INSTALL */}
      {installVisible && (
        <div className="install">
          <img className="ic" src="/icon.svg" alt="" />
          <div className="grow"><div style={{ fontWeight: 800, fontSize: 14 }}>Zainstaluj Rummikub</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{installHint}</div></div>
          <button className="btn" style={{ padding: "9px 12px" }} onClick={doInstall}>{deferredPrompt.current ? "Zainstaluj" : "Jak?"}</button>
          <button className="leave" onClick={() => setInstallVisible(false)}>✕</button>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}

function TableRow({ t, tag, mine, onOpen }: { t: GameTable; tag: string; mine?: boolean; onOpen: () => void }) {
  return (
    <div className="table-row">
      <div className="grow"><div className="nick">{t.name} {t.visibility === "private" ? "🔒" : ""}</div><div className="sub">{tag} · {timeLabel(t.time_mode)} · {t.status === "playing" ? "w trakcie" : "oczekuje"}</div></div>
      <button className="btn" style={{ padding: "8px 12px" }} onClick={onOpen}>{mine ? "Otwórz" : "Wejdź"}</button>
    </div>
  );
}

function SeatMenu({ onKick, onBan }: { onKick: () => void; onBan: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const h = () => setOpen(false); document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [open]);
  return (
    <>
      <button className="menu-btn" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>⋮</button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setOpen(false); onKick(); }}>Wyrzuć (może wrócić)</button>
          <button className="danger" onClick={() => { setOpen(false); onBan(); }}>Wyrzuć na stałe</button>
        </div>
      )}
    </>
  );
}
