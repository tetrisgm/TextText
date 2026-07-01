import Link from "next/link";

// Platform landing (root domain). Deliberately set in the product's own
// reader voice: the landing IS a specimen of the typography.
export default function Home() {
  return (
    <main className="reader" style={{ ["--post-accent" as string]: "#065ec6" }}>
      <header className="reader-masthead">
        <div className="reader-eyebrow">Write</div>
        <h1 className="reader-title">A blog that reads like a broadsheet</h1>
      </header>
      <div className="reader-prose">
        <p>
          One serif for the headlines, one quiet accent per post, and a reading
          column that puts the words first. Apple-grade craft for people who
          publish.
        </p>
        <p>
          See the live demo blog:{" "}
          <Link href="/t/demo">The Demo Broadsheet</Link>. Or read a full post
          in the reader:{" "}
          <Link href="/t/demo/why-a-broadsheet">
            Why your blog should read like a broadsheet
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
