import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiGallery } from "@/components/dev/ui-gallery";

export const metadata: Metadata = { title: "UI components" };

/** Every shared UI component in its states, for development only. */
export default function UiGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiGallery />;
}
