"use client";

import dynamic from "next/dynamic";
import type { PostEditLayerProps } from "@/components/PostEditLayerClient";

const DynamicPostEditLayer = dynamic<PostEditLayerProps>(
  () =>
    import("@/components/PostEditLayerClient").then(
      (module) => module.PostEditLayer,
    ),
  { ssr: false },
);

export function PostEditLayer(props: PostEditLayerProps) {
  return <DynamicPostEditLayer {...props} />;
}
