import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub, getVaultAccountProfile } from "@/lib/store";
import { hasAppleProvider, hasGoogleProvider, hasGithubProvider } from "@/auth";
import { connectAccountApple, connectAccountGoogle, connectAccountGithub } from "@/app/editor/connect-provider-actions";
import "@/styles/connect.css";
import "@/styles/signin.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ways to sign in", robots: { index:false, follow:false } };

export default async function SignInMethods({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  const { account } = await searchParams;
  if (typeof account !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(account)) notFound();
  const back = `/account/sign-in-methods?account=${encodeURIComponent(account)}`;
  const user = await getCurrentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(back)}`);
  const userId = await getUserIdBySub(user.sub);
  if (userId !== account) return <main className="applecms connect-shell"><section className="connect-main signin-main">
    <h1 className="connect-title">Different account</h1><p className="connect-lede">This browser is signed in to a different TextText account. Open this page in the browser profile you use for this workspace.</p>
  </section></main>;
  const profile = await getVaultAccountProfile(userId);
  if (!profile) notFound();
  const providers = [
    {id:"apple",name:"Apple",available:hasAppleProvider,action:connectAccountApple},
    {id:"google",name:"Google",available:hasGoogleProvider,action:connectAccountGoogle},
    {id:"github",name:"GitHub",available:hasGithubProvider,action:connectAccountGithub},
  ];
  return <main className="applecms connect-shell"><section className="connect-main signin-main">
    <div className="signin-topline"><a className="signin-wordmark" href="/start?to=home">TextText</a></div>
    <h1 className="connect-title">Ways to sign in</h1>
    <p className="connect-lede">{profile.email || profile.name || "Your TextText account"}</p>
    <div className="signin-stack">{providers.filter(provider=>provider.available || profile.identities.includes(provider.id)).map(provider=>
      profile.identities.includes(provider.id) ? <p key={provider.id}>{provider.name} · Connected</p> :
        <form key={provider.id} action={provider.action.bind(null,account)}><button className="ac-btn ac-btn-gray signin-btn" type="submit">Connect {provider.name}</button></form>
    )}</div>
    <p className="signin-hint">Your files stay with this account. You can return to TextText when you are finished.</p>
  </section></main>;
}
