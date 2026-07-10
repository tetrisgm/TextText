"use client";

export function preloadPostEditLayer() {
  void import("@/components/PostEditLayerClient");
  void import("@/components/LocalWorkspaceBodyEditor");
}
