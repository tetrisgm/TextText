"use client";

import { Component, Suspense, type ReactNode } from "react";
import { isSafeLinkHref } from "@/lib/content";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { DocumentEngineStyles } from "./DocumentEngineStyles";

function RenderFailure({ document, collection }: { document: DocumentSnapshot; collection: boolean }) {
  const { title, subtitle, body, fields, tags, assets } = document.content;
  if (collection) {
    return <div role="status">{title || "Untitled"} · Look unavailable</div>;
  }

  return <article className="tt-document" data-surface="system" data-measure="reading">
    <DocumentEngineStyles />
    <div className="tt-stack" data-direction="vertical" style={{ width: "min(46rem, calc(100% - 2rem))", marginInline: "auto", gap: "1rem" }}>
      <p role="status">This look could not be shown. Your content appears below.</p>
      <h1>{title || "Untitled"}</h1>
      {subtitle && <p>{subtitle}</p>}
      {body && <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>}
      {(Object.keys(fields).length > 0 || tags.length > 0 || assets.length > 0) && <details>
        <summary>Other content</summary>
        {Object.entries(fields).map(([name, value]) => <div key={name}>
          <strong>{name}</strong>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {typeof value === "string" ? value : JSON.stringify(value)}
          </div>
        </div>)}
        {tags.length > 0 && <p>Tags: {tags.join(", ")}</p>}
        {assets.map((asset, index) => <p key={asset.id}>
          {isSafeLinkHref(asset.src)
            ? <a href={asset.src} target="_blank" rel="noopener noreferrer">{asset.caption || asset.alt || `Asset ${index + 1}`}</a>
            : asset.caption || asset.alt || `Asset ${index + 1}`}
        </p>)}
      </details>}
    </div>
  </article>;
}

/** One boundary per item keeps a failed card from replacing its neighbours.
 * Suspense supplies the same fallback for server rendering, where React error
 * boundaries do not catch. No exception details or untrusted content escape. */
export class DocumentRenderBoundary extends Component<{
  document: DocumentSnapshot;
  template: unknown;
  collection?: boolean;
  children: ReactNode;
}, { failed: boolean; document: DocumentSnapshot; template: unknown }> {
  state = { failed: false, document: this.props.document, template: this.props.template };

  static getDerivedStateFromProps(props: DocumentRenderBoundary["props"], state: DocumentRenderBoundary["state"]) {
    if (props.document !== state.document || props.template !== state.template) {
      return { failed: false, document: props.document, template: props.template };
    }
    return null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const fallback = <RenderFailure document={this.props.document} collection={Boolean(this.props.collection)} />;
    if (this.state.failed) return fallback;
    return <Suspense fallback={fallback}>{this.props.children}</Suspense>;
  }
}
