// lib/uploads.ts
import api from '@/lib/api';

export interface UploadResult {
  url: string;
  key: string;
}

/**
 * يرفع ملف على R2 عن طريق presigned URL:
 * 1) يطلب إذن رفع من الباك اند (/uploads/presign)
 * 2) يرفع الملف مباشرة على R2 (مش عن طريق سيرفرنا)
 * 3) يأكد للباك اند إن الرفع خلص (/uploads/confirm) — بيسجله كـ "attached"
 *    بس من غير ما نربطه بمنتج معين لسه (ده بيحصل وقت الحفظ الفعلي)
 */
export async function uploadToR2(
  file: File,
  folder: 'products' | 'variants',
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  const { data: presigned } = await api.post('/uploads/presign', {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    folder,
  });

  await uploadWithProgress(presigned.uploadUrl, file, onProgress);

  return { url: presigned.publicUrl, key: presigned.key };
}

function uploadWithProgress(url: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      console.log("Upload status:", xhr.status);
      console.log("Response:", xhr.responseText);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed ${xhr.status}: ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => {
      console.error("XHR Network Error");
      reject(new Error("Network Error"));
    };
    xhr.send(file);
  });
}

/** يأكد إن ملف اترفع فعليًا وربطه بمنتج/فارينت معين — بيتنادى بعد نجاح الحفظ */
export async function confirmUpload(key: string, attachedType: 'product' | 'variant', attachedId: string): Promise<void> {
  try {
    await api.post('/uploads/confirm', { key, attachedType, attachedId });
  } catch {
    // best-effort — لو فشل، الـ cron هيمسحه بعد ساعة لو فعلاً مش مستخدم
  }
}

export async function deleteFromR2(key: string): Promise<void> {
  try {
    await api.delete('/uploads/image', { data: { key } });
  } catch {
    // best-effort
  }
}