import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GameApp from "@/components/GameApp";

export default async function AppPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <GameApp userId={user.id} />;
}
