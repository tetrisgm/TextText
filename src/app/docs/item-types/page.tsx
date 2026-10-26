import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Item looks in TextText",
  description: "Choose an existing presentation for a TextText document or folder.",
};

export default function ItemTypesDocsPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Item looks</p>
        <h1 className="connect-title">Choose how a document reads</h1>
        <p className="connect-lede">
          TextText keeps content in one document model. A look changes its
          presentation without moving the document or replacing its identity.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">Use an existing look</h2>
          <p>
            Open a document and choose Look to preview presentations already
            available in the workspace. Apply the one that fits. Existing
            documents keep their content, assets, and links.
          </p>
          <p>
            A folder can also have a look for the documents it contains. A
            document keeps the version it was given, so later library changes
            do not silently rewrite it.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Keep working with your files</h2>
          <p>
            Agents can edit TextPack files directly, use the local TextText
            CLI, or connect through hosted MCP. The document remains editable
            in TextText after those changes. See the{" "}
            <Link href="/docs/ai">agent guide</Link> for the connection paths.
          </p>
        </section>
      </main>
    </div>
  );
}
