export type Status = "on" | "inv" | "off";

export interface Profile {
  id: string;
  nick: string;
  code: string;
  avatar_url: string | null;
  status: Status;
  wins: number;
  games: number;
}

export interface GameTable {
  id: string;
  name: string;
  visibility: "public" | "private";
  time_mode: "none" | "30" | "60";
  host: string;
  status: "waiting" | "playing" | "closed";
  created_at: string;
}

export interface Seat extends Partial<Profile> {
  id: string;
  nick: string;
  ready: boolean;
  owner: boolean;
  me: boolean;
}

export interface ChatMessage {
  id: string;
  table_id: string;
  user_id: string;
  nick: string;
  body: string;
  created_at: string;
}
