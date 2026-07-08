import { cache } from "react";
import { auth, isAuthConfigured } from "@/auth";

export type CurrentUser = {
  sub: string;
  userId?: string;
  name?: string;
  email?: string;
};

async function getCurrentUserUncached(): Promise<CurrentUser | null> {
  if (!isAuthConfigured) return null;

  const session = await auth();
  const user = session?.user;
  const sub = user?.sub;

  if (!sub) return null;

  return {
    sub,
    userId: user.userId ?? undefined,
    name: user.name ?? undefined,
    email: user.email ?? undefined,
  };
}

const getCurrentUserCached = cache(getCurrentUserUncached);

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return getCurrentUserCached();
}
