import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  createAnonymousBlog,
  startBlogAction,
} from "@/app/editor/actions";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { redirect } from "next/navigation";

const landingStyle = {
  "--post-accent": "#065ec6",
} as CSSProperties;

const ctaStyle: CSSProperties = {
  borderBottom: 0,
  boxShadow: "0 18px 42px -28px var(--post-accent)",
  color: "var(--ac-on-accent)",
  fontSize: 17,
  height: 50,
  letterSpacing: 0,
  paddingInline: 28,
  textDecoration: "none",
};

const productStageStyle: CSSProperties = {
  display: "grid",
  gap: 22,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 430px), 1fr))",
  left: "50%",
  margin: "58px 0 0",
  maxWidth: "1120px",
  position: "relative",
  transform: "translateX(-50%)",
  width: "min(1120px, calc(100vw - 32px))",
};

const shotFrameStyle: CSSProperties = {
  background:
    "linear-gradient(180deg, var(--bg-soft-2), color-mix(in srgb, var(--bg-soft) 82%, var(--bg)))",
  border: "1px solid color-mix(in srgb, var(--hairline) 84%, transparent)",
  borderRadius: 16,
  boxShadow: "0 32px 90px -62px rgba(0, 0, 0, 0.62)",
  margin: 0,
  overflow: "hidden",
  padding: 10,
};

const shotImageStyle: CSSProperties = {
  background: "var(--bg-soft)",
  borderRadius: 10,
  display: "block",
  height: "auto",
  width: "100%",
};

const footerStyle: CSSProperties = {
  borderTop: "1px solid var(--hairline-2)",
  color: "var(--muted)",
  fontSize: 14,
  lineHeight: 1.5,
  margin: "64px auto 0",
  maxWidth: 680,
  paddingTop: 20,
  textAlign: "center",
};

const footerLinkStyle: CSSProperties = {
  borderBottom:
    "1px solid color-mix(in srgb, var(--post-accent) 28%, transparent)",
  color: "color-mix(in srgb, var(--post-accent) 46%, var(--ink))",
  textDecoration: "none",
};

function blogPath(handle: string): string {
  return `/t/${encodeURIComponent(handle)}`;
}

function ProductShot({
  alt,
  height,
  src,
  width,
}: {
  alt: string;
  height: number;
  src: string;
  width: number;
}) {
  return (
    <figure style={shotFrameStyle}>
      <Image
        alt={alt}
        height={height}
        sizes="(max-width: 900px) calc(100vw - 64px), 520px"
        src={src}
        style={shotImageStyle}
        width={width}
      />
    </figure>
  );
}

// Platform landing (root domain). Deliberately set in the product's own
// reader voice: the landing IS a specimen of the typography.
export default async function Home() {
  const user = await getCurrentUser();
  const ownedBlog = user ? await getOwnedBlog(user.sub) : null;
  const ownedBlogHref = ownedBlog ? blogPath(ownedBlog.handle) : null;

  async function startAnonymousBlog() {
    "use server";

    const handle = await createAnonymousBlog();
    redirect(blogPath(handle));
  }

  return (
    <main className="reader applecms" style={landingStyle}>
      <header className="reader-masthead">
        <h1 className="reader-title">Publish work that reads beautifully</h1>
        <p className="reader-dek">
          Write is a place to publish articles, projects, and talks in a calm
          reading column with broadsheet type and your own URL.
        </p>
        <span
          aria-hidden="true"
          style={{
            background: "var(--post-accent)",
            display: "block",
            height: 1,
            margin: "24px auto 26px",
            width: 72,
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 0,
          }}
        >
          {ownedBlogHref ? (
            <Link
              className="ac-btn ac-btn-filled"
              href={ownedBlogHref}
              style={ctaStyle}
            >
              Start a blog
            </Link>
          ) : user ? (
            <form action={startBlogAction}>
              <button
                className="ac-btn ac-btn-filled"
                style={ctaStyle}
                type="submit"
              >
                Start a blog
              </button>
            </form>
          ) : (
            <form action={startAnonymousBlog}>
              <button
                className="ac-btn ac-btn-filled"
                style={ctaStyle}
                type="submit"
              >
                Start a blog
              </button>
            </form>
          )}
        </div>
      </header>

      <section aria-label="Product screenshots" style={productStageStyle}>
        <ProductShot
          alt="Write blog home showing a publication header and article cards"
          height={1103}
          src="/shots/home.jpg"
          width={1500}
        />
        <ProductShot
          alt="Write reader view showing a published article page"
          height={1147}
          src="/shots/reader.jpg"
          width={1500}
        />
      </section>

      <footer style={footerStyle}>
        See the{" "}
        <Link href="/t/demo" style={footerLinkStyle}>
          demo
        </Link>
        .
      </footer>
    </main>
  );
}
