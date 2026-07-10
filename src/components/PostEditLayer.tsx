"use client";

import dynamic from "next/dynamic";
import type { PostEditLayerProps } from "@/components/PostEditLayerClient";
export { preloadPostEditLayer } from "@/components/preloadPostEditLayer";

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
