import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * The landing route.
 *
 * Signed-in users go to their projects; everyone else goes to the login
 * page. The check reads the session cookie only -- the authoritative
 * verification happens in `requireUser()` on the pages themselves.
 */
export default async function Home() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/projects" : "/login");
}
