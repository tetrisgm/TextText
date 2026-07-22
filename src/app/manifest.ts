import type { MetadataRoute } from "next";

const description =
  "Folders of Markdown for publishing, notes, and agent workflows.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Texttext",
    short_name: "Texttext",
    description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icon",
        sizes: "64x64",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
