import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  DocumentAsset,
  DocumentFieldValue,
  DocumentSnapshot,
} from "@/lib/documents/model";
import { isSafeLinkHref, isVideoFile, isYouTube, youtubeEmbedUrl } from "@/lib/content";
import type { RenderNode, TemplateDefinition } from "@/lib/presentation/schema";
import { DOCUMENT_ENGINE_CSS } from "@/lib/presentation/styles";

export type DocumentRenderMetadata = {
  author?: string;
  date?: string;
  readingTime?: string;
};

export type DocumentRenderSlots = {
  bindings?: Partial<Record<string, ReactNode>>;
  nodes?: Partial<Record<string, ReactNode>>;
  byline?: ReactNode;
  metadata?: ReactNode;
};

export function DocumentEngineStyles() {
  return <style>{DOCUMENT_ENGINE_CSS}</style>;
}

type RendererProps = {
  document: DocumentSnapshot;
  template: TemplateDefinition;
  documentId?: string;
  metadata?: DocumentRenderMetadata;
  slots?: DocumentRenderSlots;
  className?: string;
};

type CollectionRendererProps = Omit<RendererProps, "className"> & {
  className?: string;
};

function safeMediaSource(value: string): string {
  const src = value.trim();
  if (!src) return "";
  if (src.startsWith("/") || src.startsWith("blob:")) return src;
  return isSafeLinkHref(src) && !src.toLowerCase().startsWith("mailto:") ? src : "";
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((part) => typeof part === "string").join(", ");
  return "";
}

export function resolveDocumentBinding(
  document: DocumentSnapshot,
  binding: string,
): DocumentFieldValue | DocumentAsset[] | string[] | undefined {
  switch (binding) {
    case "content.title":
      return document.content.title;
    case "content.subtitle":
      return document.content.subtitle;
    case "content.body":
      return document.content.body;
    case "content.tags":
      return document.content.tags;
    case "content.assets":
      return document.content.assets;
    default:
      if (binding.startsWith("content.fields.")) {
        return document.content.fields[binding.slice("content.fields.".length)];
      }
      return undefined;
  }
}

function hasValue(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function textElement(role: Extract<RenderNode, { type: "text" }>["role"], props: { className: string; children: ReactNode }) {
  if (role === "title") return <h1 {...props} />;
  if (role === "heading") return <h2 {...props} />;
  if (role === "eyebrow" || role === "meta") return <div {...props} />;
  return <p {...props} />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "T";
}

function DefaultByline({ metadata }: { metadata: DocumentRenderMetadata }) {
  if (!metadata.author) return null;
  return (
    <div className="tt-byline">
      <span className="tt-byline-avatar" aria-hidden="true">{initials(metadata.author)}</span>
      <span>{metadata.author}</span>
      {metadata.readingTime && <><span className="tt-byline-separator">·</span><span>{metadata.readingTime}</span></>}
      {metadata.date && <><span className="tt-byline-separator">·</span><span>{metadata.date}</span></>}
    </div>
  );
}

function DefaultMetadata({ metadata }: { metadata: DocumentRenderMetadata }) {
  const values = [metadata.readingTime, metadata.date].filter(Boolean);
  if (values.length === 0) return null;
  return <div className="tt-metadata">{values.join(" · ")}</div>;
}

function Markdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => safeMediaSource(url)}
      components={{
        h1: "h2",
        img: ({ src, alt }) => {
          const safe = safeMediaSource(typeof src === "string" ? src : "");
          if (!safe) return null;
          if (isVideoFile(safe)) return <video src={safe} controls playsInline preload="metadata" />;
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={safe} alt={alt ?? ""} loading="lazy" decoding="async" />;
        },
        a: ({ href, children }) => {
          const safe = typeof href === "string" && isSafeLinkHref(href) ? href : "";
          return safe ? <a href={safe}>{children}</a> : <span>{children}</span>;
        },
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

function BoundMedia({
  node,
  document,
}: {
  node: Extract<RenderNode, { type: "cover" | "image" | "video" }>;
  document: DocumentSnapshot;
}) {
  const src = safeMediaSource(scalarText(resolveDocumentBinding(document, node.bind)));
  if (!src) return null;
  const alt = node.alt ? scalarText(resolveDocumentBinding(document, node.alt)) : document.content.title;
  const style = { "--tt-media-fit": node.fit } as CSSProperties;
  const className = `tt-${node.type} tt-height-${node.height}`;
  if (node.type === "video") {
    if (isYouTube(src)) {
      return (
        <div className={className} style={style}>
          <iframe src={youtubeEmbedUrl(src)} title={alt} allowFullScreen />
        </div>
      );
    }
    return <div className={className} style={style}><video src={src} controls playsInline preload="metadata" /></div>;
  }
  return (
    <div className={className} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} decoding="async" />
    </div>
  );
}

function Gallery({ assets, columns }: { assets: DocumentAsset[]; columns: number }) {
  if (assets.length === 0) return null;
  return (
    <div className="tt-gallery" style={{ "--tt-gallery-columns": columns } as CSSProperties}>
      {assets.map((asset) => {
        const src = safeMediaSource(asset.src);
        if (!src) return null;
        return (
          <figure key={asset.id}>
            {asset.kind === "video" ? (
              <video src={src} controls playsInline preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={asset.alt ?? asset.caption ?? ""} loading="lazy" decoding="async" />
            )}
            {asset.caption && <figcaption>{asset.caption}</figcaption>}
          </figure>
        );
      })}
    </div>
  );
}

function NodeRenderer({
  node,
  path,
  document,
  metadata,
  slots,
}: {
  node: RenderNode;
  path: string;
  document: DocumentSnapshot;
  metadata: DocumentRenderMetadata;
  slots?: DocumentRenderSlots;
}): ReactNode {
  const nodeSlot = node.id ? slots?.nodes?.[node.id] : undefined;
  if (nodeSlot !== undefined) return nodeSlot;
  const bindingSlot = "bind" in node ? slots?.bindings?.[node.bind] : undefined;
  if (
    node.showWhen &&
    bindingSlot === undefined &&
    !hasValue(resolveDocumentBinding(document, node.showWhen))
  ) {
    return null;
  }
  const attrs = node.id ? { "data-tt-node": node.id } : {};

  switch (node.type) {
    case "stack":
      return (
        <div {...attrs} className={`tt-stack tt-gap-${node.gap} tt-align-${node.align}`} data-direction={node.direction}>
          {node.children.map((child, index) => (
            <NodeRenderer key={`${path}.${index}`} node={child} path={`${path}.${index}`} document={document} metadata={metadata} slots={slots} />
          ))}
        </div>
      );
    case "group":
    case "masthead":
      return (
        <div {...attrs} className={`tt-${node.type} tt-gap-${node.gap}`}>
          {node.children.map((child, index) => (
            <NodeRenderer key={`${path}.${index}`} node={child} path={`${path}.${index}`} document={document} metadata={metadata} slots={slots} />
          ))}
        </div>
      );
    case "text": {
      const slot = slots?.bindings?.[node.bind];
      const value =
        slot ??
        (scalarText(resolveDocumentBinding(document, node.bind)) || node.fallback || "");
      if (!hasValue(value)) return null;
      const href = node.href
        ? scalarText(resolveDocumentBinding(document, node.href))
        : "";
      const children =
        href && isSafeLinkHref(href) ? <a href={href}>{value}</a> : value;
      return textElement(node.role, {
        className: `tt-text tt-text-${node.role}`,
        children,
      });
    }
    case "prose": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return <div className="tt-prose">{slot}</div>;
      const value = scalarText(resolveDocumentBinding(document, node.bind));
      return value ? <div className="tt-prose"><Markdown value={value} /></div> : null;
    }
    case "cover":
    case "image":
    case "video": {
      const slot = slots?.bindings?.[node.bind];
      return slot !== undefined ? slot : <BoundMedia node={node} document={document} />;
    }
    case "gallery": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      const value = resolveDocumentBinding(document, node.bind);
      return (
        <Gallery
          assets={
            Array.isArray(value)
              ? value.filter(
                  (item): item is DocumentAsset =>
                    typeof item === "object" && item !== null && "src" in item,
                )
              : []
          }
          columns={node.columns ?? 3}
        />
      );
    }
    case "byline":
      return slots?.byline ?? <DefaultByline metadata={metadata} />;
    case "metadata":
      return slots?.metadata ?? <DefaultMetadata metadata={metadata} />;
    case "divider":
      return <hr {...attrs} className="tt-divider" />;
    case "spacer":
      return <div {...attrs} className={`tt-spacer tt-gap-${node.size}`} aria-hidden="true" />;
  }
}

export function DocumentRenderer({
  document,
  template,
  documentId = "tt-document",
  metadata = {},
  slots,
  className,
}: RendererProps) {
  const scopeId = `tt-${documentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "document"}`;
  const theme = { ...template.theme, ...document.presentation.theme };
  const accent = theme.accent;
  const style = accent ? ({ "--tt-accent": accent } as CSSProperties) : undefined;
  return (
    <article
      id={scopeId}
      className={["tt-document", className].filter(Boolean).join(" ")}
      data-template={template.id}
      data-typography={theme.typography ?? "system"}
      data-density={theme.density ?? "comfortable"}
      data-measure={theme.measure ?? "reading"}
      data-corners={theme.corners ?? "subtle"}
      data-surface={theme.surface ?? "system"}
      data-title-scale={theme.titleScale ?? "standard"}
      data-alignment={theme.alignment ?? "center"}
      data-media={theme.media ?? "full"}
      style={style}
    >
      <DocumentEngineStyles />
      <NodeRenderer node={template.item} path="item" document={document} metadata={metadata} slots={slots} />
    </article>
  );
}

export function DocumentCollectionRenderer({
  document,
  template,
  documentId = "tt-collection-item",
  metadata = {},
  slots,
  className,
}: CollectionRendererProps) {
  const scopeId = `tt-${documentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "collection-item"}`;
  const theme = { ...template.theme, ...document.presentation.theme };
  const style = theme.accent
    ? ({ "--tt-accent": theme.accent } as CSSProperties)
    : undefined;

  return (
    <article
      id={scopeId}
      className={["tt-document", "tt-collection-item", className]
        .filter(Boolean)
        .join(" ")}
      data-template={template.id}
      data-typography={theme.typography ?? "system"}
      data-density={theme.density ?? "comfortable"}
      data-measure="full"
      data-corners={theme.corners ?? "subtle"}
      data-surface={theme.surface ?? "system"}
      data-title-scale="compact"
      data-alignment="start"
      data-media={theme.media ?? "full"}
      style={style}
    >
      <NodeRenderer
        node={template.collection.item}
        path="collection.item"
        document={document}
        metadata={metadata}
        slots={slots}
      />
    </article>
  );
}
