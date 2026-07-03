import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatArticleDate,
  postAccent,
  type Blog,
  type Post,
} from "@/lib/content";
import { getBlog, getPost } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

const PAPER = "#f6f1e8";
const INK = "#181510";
const MUTED = "#5f594f";
const HAIRLINE = "#2a251f";

export default async function Image({ params }: Props) {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) return new Response("Not found", { status: 404 });

  return new ImageResponse(renderImage(blog, post), {
    ...size,
    fonts: await loadFonts(),
  });
}

function renderImage(blog: Blog, post: Post) {
  const titleSize = displaySize(post.title);
  const ruleColor = hairlineColor(postAccent(blog, post));
  const meta = [post.excerpt, formatArticleDate(post.date)]
    .filter(Boolean)
    .join(" / ");

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
        <div>{blog.name}</div>
        <div>{meta}</div>
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
          maxWidth: 990,
        }}
      >
        {post.title}
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
        By {blog.author}
      </div>
    </div>
  );
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

function displaySize(title: string): number {
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
