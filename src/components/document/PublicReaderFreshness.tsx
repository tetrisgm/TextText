"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { startReaderFreshness } from "@/lib/reader-freshness";

export function PublicReaderFreshness({ postId, revision }: { postId: string; revision: string }) {
  const router = useRouter();
  useEffect(() => {
    const poll = startReaderFreshness(postId, revision, () => router.refresh());
    return () => poll.stop();
  }, [postId, revision, router]);
  return null;
}
