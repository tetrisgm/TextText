import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatArticleDate,
  postAccent,
  type Blog,
  type Post,
} from "@/lib/content";
import { coverMimeType, resolveCover } from "@/lib/cover";
import { postSubtitle } from "@/lib/markdown-subtitle";

// Shared OpenGraph card rendering for the /t/{handle} and /u/{username}
// (canonical /@{username}) route trees. The route-level opengraph-image
// files stay thin: resolve their params to a blog (and post), then delegate
// here so the visual never forks.

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

export const OG_IMAGE_CONTENT_TYPE = "image/png";

const PAPER = "#f6f1e8";
const INK = "#181510";
const MUTED = "#5f594f";
const HAIRLINE = "#2a251f";

export async function blogOgImage(blog: Blog): Promise<ImageResponse> {
  return new ImageResponse(renderBlogImage(blog), {
    ...OG_IMAGE_SIZE,
    fonts: await loadFonts(),
  });
}

export async function postOgImage(
  blog: Blog,
  post: Post,
): Promise<ImageResponse> {
  const cover = resolveCover(post);
  const coverSrc = cover ? await imageSourceForOg(cover) : "";

  return new ImageResponse(renderPostImage(blog, post, coverSrc), {
    ...OG_IMAGE_SIZE,
    fonts: await loadFonts(),
  });
}

function renderBlogImage(blog: Blog) {
  const titleSize = blogTitleSize(blog.name);
  const ruleColor = hairlineColor(blog.accent);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: PAPER,
        color: INK,
        padding: "70px 84px 64px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${HAIRLINE}`,
          paddingBottom: 20,
          fontFamily: "Inter",
          fontSize: 22,
          color: MUTED,
          letterSpacing: 0,
        }}
      >
        <div>{blog.author}</div>
        <div>Broadsheet</div>
      </div>
      <div
        style={{
          width: 126,
          height: 3,
          background: ruleColor,
          marginTop: 34,
          marginBottom: 40,
        }}
      />
      <div
        style={{
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: titleSize,
          lineHeight: 0.94,
          letterSpacing: 0,
          maxWidth: 980,
        }}
      >
        {blog.name}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          borderTop: `1px solid ${HAIRLINE}`,
          paddingTop: 22,
          fontFamily: "Inter",
          fontSize: 28,
          color: MUTED,
          letterSpacing: 0,
        }}
      >
        {blog.tagline || `By ${blog.author}`}
      </div>
    </div>
  );
}

function renderPostImage(blog: Blog, post: Post, coverSrc: string) {
  const titleSize = postTitleSize(post.title);
  const ruleColor = hairlineColor(postAccent(blog, post));
  const hasCover = Boolean(coverSrc);
  const meta = [postSubtitle(post), formatArticleDate(post.date)]
    .filter(Boolean)
    .join(" / ");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: PAPER,
        color: INK,
        padding: "70px 84px 64px",
      }}
    >
      {hasCover && (
        <img
          src={coverSrc}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {hasCover && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(10, 10, 10, 0.78) 0%, rgba(10, 10, 10, 0.58) 48%, rgba(10, 10, 10, 0.18) 100%)",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: hasCover
            ? "1px solid rgba(255, 255, 255, 0.72)"
            : "1px solid rgba(42, 37, 31, 0.32)",
          paddingBottom: 20,
          fontFamily: "Inter",
          fontSize: 22,
          color: hasCover ? "rgba(255, 255, 255, 0.82)" : INK,
          letterSpacing: 0,
        }}
      >
        <div>{blog.name}</div>
        <div>{meta}</div>
      </div>
      <div
        style={{
          position: "relative",
          width: 126,
          height: 3,
          background: ruleColor,
          marginTop: 34,
          marginBottom: 40,
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: titleSize,
          lineHeight: 0.94,
          letterSpacing: 0,
          maxWidth: 990,
          color: hasCover ? "#fff" : INK,
        }}
      >
        {post.title}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          marginTop: "auto",
          borderTop: hasCover
            ? "1px solid rgba(255, 255, 255, 0.72)"
            : "1px solid rgba(42, 37, 31, 0.32)",
          paddingTop: 22,
          fontFamily: "Inter",
          fontSize: 28,
          color: hasCover ? "rgba(255, 255, 255, 0.84)" : INK,
          letterSpacing: 0,
        }}
      >
        By {blog.author}
      </div>
    </div>
  );
}

async function imageSourceForOg(src: string): Promise<string> {
  if (!src.startsWith("/")) return src;

  try {
    const imageData = await readFile(
      join(process.cwd(), "public", src.replace(/^\/+/, "")),
      "base64",
    );
    return `data:${coverMimeType(src)};base64,${imageData}`;
  } catch {
    return src;
  }
}

async function loadFonts() {
  const fontDir = join(process.cwd(), "public", "fonts");
  const [fraunces, inter] = await Promise.all([
    readFile(join(fontDir, "Fraunces-SemiBold.ttf")),
    readFile(join(fontDir, "Inter-Regular.ttf")),
  ]);

  return [
    {
      name: "Fraunces",
      data: fraunces,
      style: "normal" as const,
      weight: 600 as const,
    },
    {
      name: "Inter",
      data: inter,
      style: "normal" as const,
      weight: 400 as const,
    },
  ];
}

function blogTitleSize(title: string): number {
  if (title.length > 70) return 64;
  if (title.length > 48) return 76;
  if (title.length > 32) return 90;
  return 112;
}

function postTitleSize(title: string): number {
  if (title.length > 82) return 58;
  if (title.length > 64) return 66;
  if (title.length > 48) return 78;
  return 94;
}

function hairlineColor(accent: string | undefined): string {
  return isHexColor(accent) ? accent : HAIRLINE;
}

function isHexColor(value: string | undefined): value is string {
  return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value || "");
}
