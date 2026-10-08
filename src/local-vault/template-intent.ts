import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";

/** A navigation intent opens a picker only. File creation always requires a click. */
export function consumeTemplateIntent(href: string, workspaceId: string): { query: string; url: string } | null {
  const url = new URL(href);
  if (url.pathname !== `/vault/${encodeURIComponent(workspaceId)}` || !url.searchParams.has("template")) return null;
  const slug = url.searchParams.get("template") ?? "";
  const aliases: Record<string, string> = { blog: "article", "blog-post": "article", presentation: "talk" };
  const retired = new Set(["todo", "project", "brief", "timeline", "page", "casestudy"]);
  const template = !retired.has(slug) && /^[a-z][a-z0-9-]{0,80}$/.test(slug)
    ? BUILTIN_TEMPLATES.find(value => value.id === `texttext.${aliases[slug] ?? slug}`) : undefined;
  url.searchParams.delete("template");
  url.searchParams.delete("seed");
  return { query: template?.name ?? "", url: url.pathname + url.search + url.hash };
}
