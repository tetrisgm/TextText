import { auth, isAuthConfigured } from "@/auth";

export type CurrentUser = {
  sub: string;
  name?: string;
  email?: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isAuthConfigured) return null;

  const session = await auth();
  const user = session?.user;
  const sub = user?.sub;

  if (!sub) return null;

  return {
    sub,
    name: user.name ?? undefined,
    email: user.email ?? undefined,
  };
}
