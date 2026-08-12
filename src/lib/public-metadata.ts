import type { Metadata } from "next";

type PublicSocialMetadataOptions = {
  description?: string | null;
  imageUrl: string;
  title: string;
  url: string;
};

/** Replace root-site social fields on every workspace-owned public page. */
export function publicSocialMetadata({
  description,
  imageUrl,
  title,
  url,
}: PublicSocialMetadataOptions): Pick<Metadata, "openGraph" | "twitter"> {
  const normalizedDescription = description?.trim() || undefined;

  return {
    openGraph: {
      title,
      description: normalizedDescription,
      type: "website",
      url,
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: normalizedDescription,
      images: [imageUrl],
    },
  };
}
