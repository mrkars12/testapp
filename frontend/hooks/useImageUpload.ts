import { useState } from "react";

const UPLOAD_API = process.env.NEXT_PUBLIC_UPLOADS_API_URL;
// في .env.local حط:
// NEXT_PUBLIC_UPLOADS_API_URL=https://your-replit-url/api/uploads

export function useImageUpload(folder: "products" | "variants" = "products") {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadImage(file: File): Promise<{ url: string; key: string } | null> {
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);

    try {
      const res = await fetch(`${UPLOAD_API}/image`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      return { url: data.url, key: data.key };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(key: string): Promise<void> {
    await fetch(`${UPLOAD_API}/image`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
  }

  return { uploadImage, deleteImage, uploading, error };
}