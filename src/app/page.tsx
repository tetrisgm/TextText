import Link from "next/link";
import { startBlogAction } from "@/app/editor/actions";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";

// Platform landing (root domain). Deliberately set in the product's own
// reader voice: the landing IS a specimen of the typography.
export default async function Home() {
  const user = isAuthConfigured ? await getCurrentUser() : null;
  const primaryLabel = user ? "Go to your blog" : "Start a blog";

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
        <div style={{ textAlign: "center", marginTop: 30, marginBottom: 18 }}>
          <form action={startBlogAction}>
            <button
              className="ac-btn ac-btn-filled"
              type="submit"
              style={{
                borderBottom: 0,
                color: "var(--ac-on-accent)",
                fontSize: 16,
                height: 46,
                paddingInline: 24,
                textDecoration: "none",
              }}
            >
              {primaryLabel}
            </button>
          </form>
        </div>
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
