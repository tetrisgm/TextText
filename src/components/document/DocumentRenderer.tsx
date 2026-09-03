import { Fragment, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  DocumentAsset,
  DocumentFieldValue,
  DocumentSnapshot,
} from "@/lib/documents/model";
import { isSafeLinkHref, isVideoFile, isYouTube, youtubeEmbedUrl } from "@/lib/content";
import { pollClosed, pollOptionLabels } from "@/lib/documents/responses";
import { PollWidget } from "./PollWidget";
import { normalizeRenderNode } from "@/lib/presentation/schema";
import type {
  DocumentFieldDefinition,
  RenderNode,
  RowSubFieldDefinition,
  TemplateDefinition,
} from "@/lib/presentation/schema";
import { DOCUMENT_ENGINE_CSS } from "@/lib/presentation/styles";
import { styleFamilyFor } from "@/lib/presentation/templates";
import { remarkHighlight } from "@/components/document/HighlightMarkdown";
import { remarkWikiLinks } from "@/components/WikiLinkMarkdown";
import type { WikiLinkRenderTargets } from "@/lib/wikilinks";

export type DocumentRenderMetadata = {
  author?: string;
  date?: string;
  readingTime?: string;
};

type DocumentRenderSlots = {
  /**
   * Editing surfaces for PLAIN bindings, keyed by binding name.
   *
   * A binding is plain or markdown according to the node that consumes it,
   * which is the same thing that decides how it renders. The editor used to
   * fill every binding here, so a `prose` node and a `text` node were handed
   * the identical raw textarea, and a note's markdown body was edited as
   * source: `## What to Create`, markers and all, inside a document whose
   * every other part was composed from the item type's own primitives.
   */
  bindings?: Partial<Record<string, ReactNode>>;
  /**
   * Editing surfaces for MARKDOWN bindings, keyed by binding name. Consumed by
   * `prose` nodes, which fall back to `bindings` so an older caller keeps
   * working unchanged.
   */
  prose?: Partial<Record<string, ReactNode>>;
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
  wikiLinkTargets?: WikiLinkRenderTargets;
  /** Miniature context: render media as a still, never a live embed. */
  preview?: boolean;
};

type CollectionRendererProps = Omit<RendererProps, "className"> & {
  className?: string;
};

type FieldDefinitionMap = ReadonlyMap<string, DocumentFieldDefinition>;

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

function resolveFieldDefinition(
  binding: string,
  fields: FieldDefinitionMap,
): DocumentFieldDefinition | undefined {
  if (!binding.startsWith("content.fields.")) return undefined;
  return fields.get(binding.slice("content.fields.".length));
}

const ROW_PREFIX = "row.";

function rowBindingId(binding: string): string {
  return binding.startsWith(ROW_PREFIX) ? binding.slice(ROW_PREFIX.length) : binding;
}

function isRowRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRowRecord) : [];
}

// ---------------------------------------------------------------------------
// Field-aware value formatting. One helper shared by badge, facts, rows, and
// text so a number field formats the same everywhere it appears.
// ---------------------------------------------------------------------------

type AnyFieldDefinition = DocumentFieldDefinition | RowSubFieldDefinition;
type EnumFieldDefinition = Extract<DocumentFieldDefinition, { type: "enum" }>;

const DAY_MS = 86_400_000;
const GROUPED_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const PERCENT_NUMBER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const LOCALIZED_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function parseDateValue(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pluralDays(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

function formatDatedValue(value: unknown, format: "date" | "relative" | "countdown"): string {
  const date = parseDateValue(value);
  if (!date) return scalarText(value);
  if (format === "date") return LOCALIZED_DATE.format(date);
  const diff = Math.round((date.getTime() - Date.now()) / DAY_MS);
  const days = Math.abs(diff);
  if (format === "relative") {
    if (diff === 0) return "today";
    return diff > 0 ? `in ${pluralDays(days)}` : `${pluralDays(days)} ago`;
  }
  if (diff === 0) return "today";
  return diff > 0 ? `${pluralDays(days)} left` : `${pluralDays(days)} ago`;
}

function formatMinutes(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) return `${hours} h ${minutes} m`;
  if (hours > 0) return `${hours} h`;
  return `${minutes} m`;
}

function formatRating(value: number, max: number | undefined): string {
  const scale = Math.max(1, Math.round(max ?? 5));
  const clamped = Math.min(scale, Math.max(0, value));
  const halves = Math.round(clamped * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const empty = Math.max(0, scale - full - (half ? 1 : 0));
  return `${"★".repeat(full)}${half ? "½" : ""}${"☆".repeat(empty)}`;
}

function formatNumberValue(
  value: number,
  definition: Extract<AnyFieldDefinition, { type: "number" }>,
): string {
  switch (definition.format ?? "plain") {
    case "currency":
      return GROUPED_NUMBER.format(value);
    case "percent":
      return PERCENT_NUMBER.format(value);
    case "minutes":
      return formatMinutes(value);
    case "rating":
      return formatRating(value, definition.max);
    default:
      return String(value);
  }
}

function enumOption(definition: EnumFieldDefinition, value: string) {
  return definition.options.find((option) => option.value === value);
}

/** Format a resolved field value for display. Falls back to plain scalar text
 * whenever no definition is known, so core bindings keep their behavior. */
export function formatFieldValue(value: unknown, definition?: AnyFieldDefinition): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === "string");
    if (definition?.type === "enum") {
      return parts.map((part) => enumOption(definition, part)?.label ?? part).join(", ");
    }
    return parts.join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && definition?.type === "number") {
    return formatNumberValue(value, definition);
  }
  if (definition?.type === "date") return formatDatedValue(value, "date");
  if (definition?.type === "enum" && typeof value === "string") {
    return enumOption(definition, value)?.label ?? value;
  }
  return scalarText(value);
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

// The component map and its entries must be MODULE-LEVEL constants. React
// matches elements by type identity: an inline function recreated per render
// is a brand-new component type, so every image and link unmounted and
// remounted on any re-render of the reader - visible as all images blinking
// (and nudging layout while they re-decoded) on every click in the workspace.

type AssetDimensions = ReadonlyMap<string, { width: number; height: number }>;

/**
 * A lazy image finishing its load above the visible region grows the content
 * and pushes what the reader is looking at. Chromium's scroll anchoring
 * compensates on its own; WebKit has none, and the Mac app runs WebKit, so
 * fast paging through an image-heavy document made the page visibly jump.
 * Images with known dimensions never need this - their space is reserved.
 */
function compensateAboveViewportImageLoad(
  event: React.SyntheticEvent<HTMLImageElement>,
) {
  const image = event.currentTarget;
  const scroller = image.closest(".post-editor-content");
  if (!(scroller instanceof HTMLElement)) return;
  const rect = image.getBoundingClientRect();
  const viewTop = scroller.getBoundingClientRect().top;
  if (rect.bottom <= viewTop) scroller.scrollTop += rect.height;
}

function markdownImageFor(dimensions: AssetDimensions | null) {
  return function MarkdownImage({ src, alt }: { src?: unknown; alt?: string }) {
    const safe = safeMediaSource(typeof src === "string" ? src : "");
    if (!safe) return null;
    if (isVideoFile(safe)) return <video src={safe} controls playsInline preload="metadata" />;
    const size = dimensions?.get(safe);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safe}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        width={size?.width}
        height={size?.height}
        onLoad={size ? undefined : compensateAboveViewportImageLoad}
      />
    );
  };
}

function MarkdownLink({
  href,
  children,
  className,
}: {
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const safe = typeof href === "string" && isSafeLinkHref(href) ? href : "";
  return safe ? (
    <a href={safe} className={className}>
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

const markdownComponents: Components = {
  h1: "h2",
  img: markdownImageFor(null),
  a: MarkdownLink,
};

// One components map per dimensions map, cached by identity: the entries must
// keep the SAME component identity across renders (a fresh function is a new
// element type and React would remount every image - the blink bug). This is
// a server-safe stand-in for context, which shared RSC modules cannot use.
const componentsByDimensions = new WeakMap<object, Components>();

function markdownComponentsFor(dimensions: AssetDimensions | null): Components {
  if (!dimensions) return markdownComponents;
  let cached = componentsByDimensions.get(dimensions);
  if (!cached) {
    cached = { ...markdownComponents, img: markdownImageFor(dimensions) };
    componentsByDimensions.set(dimensions, cached);
  }
  return cached;
}

const basePlugins = [remarkGfm, remarkHighlight];

function markdownUrlTransform(url: string): string {
  return safeMediaSource(url);
}

/** Memoized: the reader re-renders with every workspace interaction, and
 * re-parsing an unchanged body (plus the remount hazard above) is wasted. */
const Markdown = memo(function Markdown({
  value,
  wikiLinkTargets,
  assets,
}: {
  value: string;
  wikiLinkTargets?: WikiLinkRenderTargets;
  assets?: readonly DocumentAsset[];
}) {
  const plugins = useMemo(
    () =>
      wikiLinkTargets
        ? [...basePlugins, remarkWikiLinks(wikiLinkTargets)]
        : basePlugins,
    [wikiLinkTargets],
  );
  const dimensions = useMemo(() => {
    if (!assets?.length) return null;
    const map = new Map<string, { width: number; height: number }>();
    for (const asset of assets) {
      if (asset.width && asset.height) {
        map.set(asset.src, { width: asset.width, height: asset.height });
      }
    }
    return map.size > 0 ? map : null;
  }, [assets]);
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      urlTransform={markdownUrlTransform}
      components={markdownComponentsFor(dimensions)}
    >
      {value}
    </ReactMarkdown>
  );
});

function BoundMedia({
  node,
  document,
  preview,
}: {
  node: Extract<RenderNode, { type: "media" }>;
  document: DocumentSnapshot;
  preview?: boolean;
}) {
  const src = safeMediaSource(scalarText(resolveDocumentBinding(document, node.bind)));
  if (!src) return null;
  const alt = node.alt ? scalarText(resolveDocumentBinding(document, node.alt)) : document.content.title;
  const style = { "--tt-media-fit": node.fit } as CSSProperties;
  // tt-cover / tt-image / tt-video exactly as before: the CSS and the look
  // eval select on these, so the class is the kind, never the node type.
  const className = `tt-${node.kind} tt-height-${node.height}`;
  if (node.kind === "video") {
    if (preview) {
      return (
        <div className={`${className} tt-media-still`} style={style}>
          <span aria-hidden="true" />
        </div>
      );
    }
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

// The node's own attributes have to reach the element, or a template that
// names a node cannot style it: three [data-tt-node="gallery-media"] rules
// were dead because this wrapper dropped them.
function Gallery({
  assets,
  columns,
  attrs,
}: {
  assets: DocumentAsset[];
  columns: number;
  attrs?: NodeAttrs;
}) {
  if (assets.length === 0) return null;
  return (
    <div {...attrs} className="tt-gallery" style={{ "--tt-gallery-columns": columns } as CSSProperties}>
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

// ---------------------------------------------------------------------------
// Wave-1 nodes: badge, facts, checklist, rows, progress, callout, quote.
// Tones are engine-owned CSS classes; no user color ever reaches these.
// ---------------------------------------------------------------------------

type NodeAttrs = { "data-tt-node"?: string };

function toneClass(tone: string | undefined): string {
  return `tt-tone-${tone ?? "neutral"}`;
}

function EnumPills({
  definition,
  values,
  showIcon,
}: {
  definition: EnumFieldDefinition;
  values: string[];
  showIcon: boolean;
}) {
  return (
    <>
      {values.map((value, index) => {
        const option = enumOption(definition, value);
        return (
          <span key={`${value}.${index}`} className={`tt-pill ${toneClass(option?.tone)}`}>
            {showIcon && option?.icon ? (
              <span className="tt-pill-icon" aria-hidden="true">{option.icon}</span>
            ) : null}
            {option?.label ?? value}
          </span>
        );
      })}
    </>
  );
}

/** A single cell/meta value: enum values become tinted pills, booleans a
 * check, everything else field-formatted text. */
function CellValue({
  value,
  definition,
}: {
  value: unknown;
  definition?: AnyFieldDefinition;
}): ReactNode {
  if (!hasValue(value)) return null;
  if (definition?.type === "enum") {
    const values = Array.isArray(value)
      ? value.filter((part): part is string => typeof part === "string")
      : [scalarText(value)];
    return (
      <span className="tt-badge">
        <EnumPills definition={definition} values={values} showIcon />
      </span>
    );
  }
  if (definition?.type === "boolean") {
    return value === true ? <span className="tt-cell-check" aria-hidden="true">✓</span> : null;
  }
  if (definition?.type === "url") {
    const href = scalarText(value).trim();
    if (isSafeLinkHref(href)) {
      return (
        <a className="tt-cell-link" href={href}>
          {href.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
        </a>
      );
    }
  }
  return formatFieldValue(value, definition);
}

function BadgeNode({
  node,
  document,
  fields,
  attrs,
}: {
  node: Extract<RenderNode, { type: "badge" }>;
  document: DocumentSnapshot;
  fields: FieldDefinitionMap;
  attrs: NodeAttrs;
}) {
  // Row-scoped badge bindings only make sense inside a rows context, where
  // cell values render directly; standalone they resolve to nothing.
  if (node.bind.startsWith(ROW_PREFIX)) return null;
  const definition = resolveFieldDefinition(node.bind, fields);
  const raw = resolveDocumentBinding(document, node.bind);
  if (!hasValue(raw)) return null;
  const variant = node.variant ?? "pill";
  const showIcon = node.showIcon !== false;
  if (typeof raw === "boolean") {
    return (
      <span
        {...attrs}
        className={`tt-badge tt-badge-glyph ${toneClass("accent")}`}
        data-variant={variant}
        aria-hidden="true"
      >
        {variant === "glyph" ? "★" : "●"}
      </span>
    );
  }
  if (definition?.type === "reference") {
    const ids = Array.isArray(raw)
      ? raw.filter((part): part is string => typeof part === "string")
      : [scalarText(raw)];
    return (
      <span {...attrs} className="tt-badge" data-variant={variant}>
        {ids.map((id, index) => (
          <span key={`${id}.${index}`} className={`tt-pill ${toneClass("neutral")} tt-badge-ref`}>
            <span className="tt-pill-icon" aria-hidden="true">📄</span>
            {id}
          </span>
        ))}
      </span>
    );
  }
  const values = Array.isArray(raw)
    ? raw.filter((part): part is string => typeof part === "string")
    : [scalarText(raw)];
  if (values.length === 0) return null;
  if (definition?.type === "enum") {
    return (
      <span {...attrs} className="tt-badge" data-variant={variant}>
        <EnumPills definition={definition} values={values} showIcon={showIcon} />
      </span>
    );
  }
  return (
    <span {...attrs} className="tt-badge" data-variant={variant}>
      {values.map((value, index) => (
        <span key={`${value}.${index}`} className={`tt-pill ${toneClass("neutral")}`}>
          {value}
        </span>
      ))}
    </span>
  );
}

function FactsNode({
  node,
  document,
  fields,
  attrs,
}: {
  node: Extract<RenderNode, { type: "facts" }>;
  document: DocumentSnapshot;
  fields: FieldDefinitionMap;
  attrs: NodeAttrs;
}) {
  const variant = node.variant ?? "strip";
  const items: { label: string; value: string; rich?: ReactNode }[] = [];
  for (const entry of node.entries) {
    const definition = resolveFieldDefinition(entry.bind, fields);
    const raw = resolveDocumentBinding(document, entry.bind);
    if (!hasValue(raw)) continue;
    let value: string;
    let rich: ReactNode;
    if (entry.derive) {
      const records = rowRecords(raw);
      if (records.length === 0) continue;
      if (entry.derive.op === "count") {
        value = String(records.length);
      } else if (entry.derive.op === "sum") {
        const subId = rowBindingId(entry.derive.of);
        const sub = subFieldMap(definition).get(subId);
        const total = records.reduce((sum, record) => {
          const cell = record[subId];
          return typeof cell === "number" && Number.isFinite(cell) ? sum + cell : sum;
        }, 0);
        value = formatFieldValue(total, sub);
      } else {
        const subId = rowBindingId(entry.derive.of);
        const done = records.filter((record) => record[subId] === true).length;
        value = `${done} of ${records.length}`;
      }
    } else {
      value = entry.format
        ? formatDatedValue(raw, entry.format)
        : formatFieldValue(raw, definition);
      // The table variant keeps a field's own presentation: an enum stays a
      // tinted pill, a URL a link, instead of both flattening to plain text.
      if (!entry.format && (definition?.type === "enum" || definition?.type === "url")) {
        rich = <CellValue value={raw} definition={definition} />;
      }
    }
    if (!value.trim()) continue;
    const label = entry.label ?? definition?.label ?? entry.bind.split(".").pop() ?? "";
    items.push({ label, value, rich });
  }
  if (items.length === 0) return null;
  if (variant === "table") {
    return (
      <dl {...attrs} className="tt-facts tt-facts-table">
        {items.map((item, index) => (
          <Fragment key={index}>
            <dt>{item.label}</dt>
            <dd>{item.rich ?? item.value}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }
  if (variant === "pills") {
    return (
      <div {...attrs} className="tt-facts tt-facts-pills">
        {items.map((item, index) => (
          <span key={index} className={`tt-pill ${toneClass("neutral")}`}>
            <span className="tt-fact-label">{item.label}:</span> {item.value}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div {...attrs} className="tt-facts tt-facts-strip">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="tt-facts-sep" aria-hidden="true">·</span>}
          <span className="tt-fact">
            <span className="tt-fact-label">{item.label}</span>
            {item.value}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function subFieldMap(
  definition: DocumentFieldDefinition | undefined,
): ReadonlyMap<string, RowSubFieldDefinition> {
  if (!definition || definition.type !== "rows") return new Map();
  return new Map(definition.fields.map((sub) => [sub.id, sub]));
}

function ChecklistNode({
  node,
  document,
  fields,
  attrs,
}: {
  node: Extract<RenderNode, { type: "checklist" }>;
  document: DocumentSnapshot;
  fields: FieldDefinitionMap;
  attrs: NodeAttrs;
}) {
  const records = rowRecords(resolveDocumentBinding(document, node.bind));
  if (records.length === 0) return null;
  const subFields = subFieldMap(resolveFieldDefinition(node.bind, fields));
  const doneId = rowBindingId(node.doneBind);
  const labelId = rowBindingId(node.labelBind);
  const doneCount = records.filter((record) => record[doneId] === true).length;
  const ordered =
    node.sortCheckedLast === false
      ? records
      : [...records].sort(
          (a, b) => Number(a[doneId] === true) - Number(b[doneId] === true),
        );
  return (
    <div {...attrs} className="tt-checklist" data-mode={node.mode ?? "document"}>
      {node.rollup ? (
        <div className="tt-checklist-rollup">{doneCount} of {records.length}</div>
      ) : null}
      <ul className="tt-checklist-items">
        {ordered.map((record, index) => {
          const done = record[doneId] === true;
          return (
            <li key={index} className="tt-checklist-item" data-done={done ? "true" : undefined}>
              <span
                className={done ? "tt-checkbox tt-checkbox-done" : "tt-checkbox"}
                aria-hidden="true"
              >
                {done ? "✓" : ""}
              </span>
              <span className="tt-checklist-label">{scalarText(record[labelId])}</span>
              {(node.meta ?? []).map((metaBind) => {
                const metaId = rowBindingId(metaBind);
                const metaDefinition = subFields.get(metaId);
                const metaValue = record[metaId];
                if (!hasValue(metaValue)) return null;
                if (metaDefinition?.type === "enum") {
                  const values = Array.isArray(metaValue)
                    ? metaValue.filter((part): part is string => typeof part === "string")
                    : [scalarText(metaValue)];
                  return (
                    <EnumPills key={metaId} definition={metaDefinition} values={values} showIcon />
                  );
                }
                return (
                  <span key={metaId} className={`tt-pill ${toneClass("neutral")}`}>
                    {formatFieldValue(metaValue, metaDefinition)}
                  </span>
                );
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function compareCellValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function sortRecords(
  records: Record<string, unknown>[],
  sort: { bind: string; direction: "asc" | "desc" } | undefined,
): Record<string, unknown>[] {
  if (!sort) return records;
  const id = rowBindingId(sort.bind);
  const ordered = [...records].sort((a, b) => compareCellValues(a[id], b[id]));
  return sort.direction === "desc" ? ordered.reverse() : ordered;
}

function RowsNode({
  node,
  document,
  fields,
  attrs,
}: {
  node: Extract<RenderNode, { type: "rows" }>;
  document: DocumentSnapshot;
  fields: FieldDefinitionMap;
  attrs: NodeAttrs;
}) {
  const definition = resolveFieldDefinition(node.bind, fields);
  const rowsField = definition?.type === "rows" ? definition : undefined;
  const records = rowRecords(resolveDocumentBinding(document, node.bind));
  if (records.length === 0) return null;
  const subFields = subFieldMap(definition);
  const declared = node.columns ?? [];
  const columnSpecs: { bind: string; label?: string }[] =
    declared.length > 0
      ? declared
      : rowsField
        ? rowsField.fields
            .filter((sub) => sub.visibility === undefined || sub.visibility === "public")
            .map((sub) => ({ bind: `${ROW_PREFIX}${sub.id}` }))
        : [];
  if (columnSpecs.length === 0) return null;
  const columns = columnSpecs.map((column) => {
    const id = rowBindingId(column.bind);
    const sub = subFields.get(id);
    return { id, definition: sub, label: column.label ?? sub?.label ?? id };
  });
  const ordered = sortRecords(records, node.sort);
  const variant = node.variant ?? "table";

  if (variant === "steps") {
    return (
      <ol {...attrs} className="tt-rows tt-rows-steps">
        {ordered.map((record, index) => (
          <li key={index} className="tt-rows-step">
            <div className="tt-rows-step-body">
              {columns.map((column, position) => {
                const value = record[column.id];
                if (!hasValue(value)) return null;
                return (
                  <div
                    key={column.id}
                    className={position === 0 ? "tt-rows-step-lead" : "tt-rows-step-detail"}
                  >
                    <CellValue value={value} definition={column.definition} />
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (variant === "timeline") {
    const dateColumn = columns.find((column) => column.definition?.type === "date");
    // A "reached" flag is the state of the entry, not another line in it.
    // Rendered as a body column it printed a bare tick on its own row under
    // the milestone it belonged to.
    const doneColumn = columns.find(
      (column) => column.definition?.type === "boolean",
    );
    const bodyColumns = columns.filter(
      (column) => column !== dateColumn && column !== doneColumn,
    );
    return (
      <ol {...attrs} className="tt-rows tt-rows-timeline">
        {ordered.map((record, index) => (
          <li
            key={index}
            data-reached={
              doneColumn && record[doneColumn.id] === true ? "true" : undefined
            }
          >
            {dateColumn && hasValue(record[dateColumn.id]) ? (
              <div className="tt-rows-timeline-date">
                {formatDatedValue(record[dateColumn.id], "date")}
              </div>
            ) : null}
            <div className="tt-rows-timeline-body">
              {bodyColumns.map((column, position) => {
                const value = record[column.id];
                if (!hasValue(value)) return null;
                return (
                  <div
                    key={column.id}
                    className={position === 0 ? "tt-rows-step-lead" : "tt-rows-step-detail"}
                  >
                    <CellValue value={value} definition={column.definition} />
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (variant === "tiles") {
    return (
      <div {...attrs} className="tt-rows tt-rows-tiles">
        {ordered.map((record, index) => (
          <div key={index} className="tt-rows-tile">
            {columns.map((column, position) => {
              const value = record[column.id];
              if (!hasValue(value)) return null;
              return (
                <div
                  key={column.id}
                  className={position === 0 ? "tt-rows-tile-value" : "tt-rows-tile-label"}
                >
                  <CellValue value={value} definition={column.definition} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div {...attrs} className="tt-rows tt-rows-table-wrap">
      <table className="tt-rows-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" data-kind={column.definition?.type}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((record, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.id} data-kind={column.definition?.type}>
                  <CellValue value={record[column.id]} definition={column.definition} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressNode({
  node,
  document,
  attrs,
}: {
  node: Extract<RenderNode, { type: "progress" }>;
  document: DocumentSnapshot;
  attrs: NodeAttrs;
}) {
  const source = node.source;
  let ratio: number | null = null;
  let current: number | null = null;
  let target: number | null = null;
  if ("bind" in source) {
    const value = resolveDocumentBinding(document, source.bind);
    if (typeof value === "number" && Number.isFinite(value)) ratio = value;
  } else if ("currentBind" in source) {
    const rawCurrent = resolveDocumentBinding(document, source.currentBind);
    const rawTarget = resolveDocumentBinding(document, source.targetBind);
    if (
      typeof rawCurrent === "number" &&
      Number.isFinite(rawCurrent) &&
      typeof rawTarget === "number" &&
      Number.isFinite(rawTarget)
    ) {
      current = rawCurrent;
      target = rawTarget;
      ratio = rawTarget > 0 ? rawCurrent / rawTarget : 0;
    }
  } else {
    const records = rowRecords(resolveDocumentBinding(document, source.checklistBind));
    const doneId = rowBindingId(source.doneBind);
    current = records.filter((record) => record[doneId] === true).length;
    target = records.length;
    ratio = target > 0 ? current / target : 0;
  }
  if (ratio == null) return null;
  const clamped = Math.min(1, Math.max(0, ratio));
  const percent = Math.round(clamped * 100);
  const aria = {
    role: "progressbar" as const,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": percent,
  };
  const variant = node.variant ?? "bar";
  if (variant === "fraction") {
    return (
      <div {...attrs} {...aria} className="tt-progress tt-progress-fraction">
        {current != null && target != null ? `${current} of ${target}` : `${percent}%`}
      </div>
    );
  }
  if (variant === "ring") {
    const radius = 15.5;
    const circumference = 2 * Math.PI * radius;
    return (
      <div {...attrs} {...aria} className="tt-progress tt-progress-ring">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle
            className="tt-progress-ring-track"
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3.5"
          />
          <circle
            className="tt-progress-ring-fill"
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3.5"
            strokeDasharray={`${(clamped * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
          />
        </svg>
        <span className="tt-progress-label">{percent}%</span>
      </div>
    );
  }
  return (
    <div {...attrs} {...aria} className="tt-progress tt-progress-bar">
      <div className="tt-progress-track">
        <div className="tt-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="tt-progress-label">{percent}%</span>
    </div>
  );
}

const CALLOUT_GLYPHS: Record<string, string> = {
  note: "✎",
  tip: "✦",
  success: "✓",
  warning: "!",
  danger: "✕",
  decision: "◆",
};

function NodeRenderer({
  node,
  path,
  document,
  metadata,
  slots,
  fields,
  documentId,
  wikiLinkTargets,
  preview,
}: {
  node: RenderNode;
  path: string;
  document: DocumentSnapshot;
  metadata: DocumentRenderMetadata;
  slots?: DocumentRenderSlots;
  fields: FieldDefinitionMap;
  documentId?: string;
  wikiLinkTargets?: WikiLinkRenderTargets;
  preview?: boolean;
}): ReactNode {
  // Legacy spellings normalise HERE, not on parse. Rewriting on parse would
  // make every serializer downstream emit the new names, and a textpack
  // exported after that could not be read by an earlier build. Reading both
  // and writing neither keeps a rollback safe.
  node = normalizeRenderNode(node) as RenderNode;
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
  const attrs: NodeAttrs = node.id ? { "data-tt-node": node.id } : {};

  switch (node.type) {
    case "stack":
      return (
        <div {...attrs} className={`tt-stack tt-gap-${node.gap} tt-align-${node.align}`} data-direction={node.direction}>
          {node.children.map((child, index) => (
            <NodeRenderer key={`${path}.${index}`} node={child} path={`${path}.${index}`} document={document} metadata={metadata} slots={slots} fields={fields} documentId={documentId} wikiLinkTargets={wikiLinkTargets} preview={preview} />
          ))}
        </div>
      );
    case "group":
    case "masthead":
      return (
        <div {...attrs} className={`tt-${node.type} tt-gap-${node.gap}`}>
          {node.children.map((child, index) => (
            <NodeRenderer key={`${path}.${index}`} node={child} path={`${path}.${index}`} document={document} metadata={metadata} slots={slots} fields={fields} documentId={documentId} wikiLinkTargets={wikiLinkTargets} preview={preview} />
          ))}
        </div>
      );
    case "text": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) {
        return (
          <div {...attrs} className={`tt-text tt-text-${node.role}`}>
            {slot}
          </div>
        );
      }
      const value =
        formatFieldValue(
          resolveDocumentBinding(document, node.bind),
          resolveFieldDefinition(node.bind, fields),
        ) ||
          node.fallback ||
          "";
      if (!hasValue(value)) return null;
      const href = node.href
        ? scalarText(resolveDocumentBinding(document, node.href))
        : "";
      // A field bound as both its own text and its own link is a raw URL on
      // the page (the bookmark's source link). Show the host; the full URL
      // stays in the link. Same treatment table cells already give URLs.
      let display = value;
      if (
        typeof value === "string" &&
        href &&
        value.trim() === href.trim() &&
        /^https?:\/\//i.test(href)
      ) {
        try {
          display = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          display = value;
        }
      }
      const children =
        href && isSafeLinkHref(href) ? (
          <a href={href} title={href === display ? undefined : href}>
            {display}
          </a>
        ) : (
          display
        );
      return textElement(node.role, {
        ...attrs,
        className: `tt-text tt-text-${node.role}`,
        children,
      });
    }
    case "prose": {
      const slot = slots?.prose?.[node.bind] ?? slots?.bindings?.[node.bind];
      if (slot !== undefined) return <div className="tt-prose">{slot}</div>;
      const value = scalarText(resolveDocumentBinding(document, node.bind));
      return value ? <div className="tt-prose"><Markdown value={value} wikiLinkTargets={wikiLinkTargets} assets={document.content.assets} /></div> : null;
    }
    // cover, image and video normalise to media before they reach here.
    case "media": {
      const slot = slots?.bindings?.[node.bind];
      return slot !== undefined ? (
        slot
      ) : (
        <BoundMedia node={node} document={document} preview={preview} />
      );
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
          attrs={attrs}
          columns={node.columns ?? 3}
        />
      );
    }
    // byline/metadata and divider/spacer arrive here as meta and space: the
    // schema normalises the legacy spellings on parse. The class names keep
    // the old words because the engine CSS and the look eval select on them.
    //

    case "meta":
      return node.variant === "metadata"
        ? (slots?.metadata ?? <DefaultMetadata metadata={metadata} />)
        : (slots?.byline ?? <DefaultByline metadata={metadata} />);
    case "space":
      return node.rule ? (
        <hr {...attrs} className="tt-divider" />
      ) : (
        <div {...attrs} className={`tt-spacer tt-gap-${node.size}`} aria-hidden="true" />
      );
    case "badge": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      return <BadgeNode node={node} document={document} fields={fields} attrs={attrs} />;
    }
    case "toggle": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      const on = resolveDocumentBinding(document, node.bind) === true;
      const label = node.labelBind
        ? formatFieldValue(
            resolveDocumentBinding(document, node.labelBind),
            resolveFieldDefinition(node.labelBind, fields),
          )
        : (node.label ?? "");
      return (
        <span
          {...attrs}
          className="tt-toggle"
          data-variant={node.variant}
          data-on={on ? "true" : undefined}
        >
          <span className="tt-toggle-mark" aria-hidden="true" />
          <span className="tt-visually-hidden">{on ? "Done" : "Not done"}</span>
          {label ? <span className="tt-toggle-label">{label}</span> : null}
        </span>
      );
    }
    case "facts":
      return <FactsNode node={node} document={document} fields={fields} attrs={attrs} />;
    case "checklist": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      return <ChecklistNode node={node} document={document} fields={fields} attrs={attrs} />;
    }
    case "rows": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      return <RowsNode node={node} document={document} fields={fields} attrs={attrs} />;
    }
    case "poll": {
      const slot = slots?.bindings?.[node.bind];
      if (slot !== undefined) return slot;
      const labels = pollOptionLabels(document, node);
      if (labels.length === 0) return null;
      return (
        <PollWidget
          postId={documentId ?? ""}
          fieldId={node.bind.slice("content.fields.".length)}
          labels={labels}
          multiple={node.multiple === true}
          closed={pollClosed(document, node, new Date())}
        />
      );
    }
    case "progress":
      return <ProgressNode node={node} document={document} attrs={attrs} />;
    case "callout": {
      const tone = node.tone ?? "note";
      const icon = node.icon ?? CALLOUT_GLYPHS[tone] ?? CALLOUT_GLYPHS.note;
      return (
        <aside {...attrs} className={`tt-callout tt-callout-${tone}`}>
          {node.title ? (
            <div className="tt-callout-title">
              <span className="tt-callout-icon" aria-hidden="true">{icon}</span>
              {node.title}
            </div>
          ) : null}
          <div className="tt-callout-body">
            {node.children.map((child, index) => (
              <NodeRenderer key={`${path}.${index}`} node={child} path={`${path}.${index}`} document={document} metadata={metadata} slots={slots} fields={fields} documentId={documentId} wikiLinkTargets={wikiLinkTargets} preview={preview} />
            ))}
          </div>
        </aside>
      );
    }
    case "quote": {
      const slot = slots?.bindings?.[node.bind];
      const value = slot ?? scalarText(resolveDocumentBinding(document, node.bind));
      if (!hasValue(value)) return null;
      const variant = node.variant ?? "block";
      const attribution =
        variant === "attributed" && node.attributionBind
          ? scalarText(resolveDocumentBinding(document, node.attributionBind))
          : "";
      return (
        <blockquote {...attrs} className="tt-quote" data-variant={variant}>
          <p>{value}</p>
          {attribution ? <footer className="tt-quote-attribution">{attribution}</footer> : null}
        </blockquote>
      );
    }
  }
}

function templateFieldMap(template: TemplateDefinition): FieldDefinitionMap {
  return new Map(template.fields.map((field) => [field.id, field]));
}

export function DocumentRenderer({
  document,
  template,
  documentId = "tt-document",
  metadata = {},
  slots,
  className,
  wikiLinkTargets,
  preview,
}: RendererProps) {
  const scopeId = `tt-${documentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "document"}`;
  const theme = { ...template.theme, ...document.presentation.theme };
  const accent = theme.accent;
  const style = accent ? ({ "--tt-accent": accent } as CSSProperties) : undefined;
  // A miniature in the look gallery is the same document drawn at card size.
  // It must not behave like a page: only a real page paints its paper across
  // the window.
  return (
    <article
      id={scopeId}
      className={["tt-document", className].filter(Boolean).join(" ")}
      data-template={template.id}
      data-style-family={styleFamilyFor(template.id)}
      data-preview={preview ? "true" : undefined}
      data-typography={theme.typography ?? "system"}
      data-density={theme.density ?? "comfortable"}
      data-measure={theme.measure ?? "reading"}
      data-corners={theme.corners ?? "subtle"}
      data-surface={theme.surface ?? "system"}
      data-title-scale={theme.titleScale ?? "standard"}
      data-body-scale={theme.bodyScale ?? "standard"}
      data-alignment={theme.alignment ?? "center"}
      data-media={theme.media ?? "full"}
      style={style}
    >
      <DocumentEngineStyles />
      <NodeRenderer node={template.item} path="item" document={document} metadata={metadata} slots={slots} fields={templateFieldMap(template)} documentId={documentId} wikiLinkTargets={wikiLinkTargets} preview={preview} />
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
      data-style-family={styleFamilyFor(template.id)}
      data-typography={theme.typography ?? "system"}
      data-density={theme.density ?? "comfortable"}
      data-measure="full"
      data-corners={theme.corners ?? "subtle"}
      data-surface={theme.surface ?? "system"}
      data-title-scale="compact"
      data-body-scale={theme.bodyScale ?? "standard"}
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
        fields={templateFieldMap(template)}
        documentId={documentId}
      />
    </article>
  );
}
