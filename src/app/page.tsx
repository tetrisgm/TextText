import Link from "next/link";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";

// Platform landing (root domain). Deliberately set in the product's own
// reader voice: the landing IS a specimen of the typography.
export default async function Home() {
  const user = isAuthConfigured ? await getCurrentUser() : null;
  const blog = user ? await getOwnedBlog(user.sub) : null;
  const primaryCta = user
    ? {
        href: blog ? `/t/${encodeURIComponent(blog.handle)}` : "/editor",
        label: "Go to your blog",
      }
    : {
        href: "/editor",
        label: "Sign in",
      };

  return (
    <main
      className="reader applecms"
      style={{ ["--post-accent" as string]: "#065ec6" }}
    >
      <header className="reader-masthead">
        <h1 className="reader-title">Publish work that reads beautifully</h1>
      </header>
      <div className="reader-prose">
        <p>
          Write is a place to publish articles, projects, and talks with
          broadsheet typography, quiet structure, and a reading column that puts
          the work first.
        </p>
        <p style={{ textAlign: "center", marginTop: 30, marginBottom: 18 }}>
          <Link
            className="ac-btn ac-btn-filled"
            href={primaryCta.href}
            style={{
              borderBottom: 0,
              color: "var(--ac-on-accent)",
              fontSize: 16,
              height: 46,
              paddingInline: 24,
              textDecoration: "none",
            }}
          >
            {primaryCta.label}
          </Link>
        </p>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 16,
            lineHeight: 1.55,
            textAlign: "center",
          }}
        >
          See the <Link href="/t/demo">demo blog</Link> or read{" "}
          <Link href="/t/demo/why-a-broadsheet">a sample post</Link>.
        </p>
      </div>
    </main>
  );
}
