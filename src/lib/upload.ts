"use client";

export const MEDIA_UPLOAD_ENDPOINT = "/editor/upload";
export const MEDIA_UPLOAD_FIELD_NAME = "file";
export const MEDIA_UPLOAD_MAX_SIZE_BYTES = 50 * 1024 * 1024;

export function mediaUploadEndpointForHandle(handle: string) {
  return `${MEDIA_UPLOAD_ENDPOINT}?handle=${encodeURIComponent(handle)}`;
}

export interface MediaUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface UploadMediaOptions {
  endpoint?: string;
  fieldName?: string;
  signal?: AbortSignal;
  onProgress?: (progress: MediaUploadProgress) => void;
}

export class MediaUploadError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MediaUploadError";
    this.status = status;
  }
}

interface UploadResponse {
  url?: unknown;
  error?: unknown;
}

function mediaTypeIsAllowed(file: File) {
  const type = file.type.toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/");
}

function uploadMessage(payload: UploadResponse | null, fallback: string) {
  return typeof payload?.error === "string" && payload.error ? payload.error : fallback;
}

function readUploadResponse(xhr: XMLHttpRequest): UploadResponse | null {
  if (xhr.response && typeof xhr.response === "object") {
    return xhr.response as UploadResponse;
  }

  if (!xhr.responseText) return null;

  try {
    return JSON.parse(xhr.responseText) as UploadResponse;
  } catch {
    return null;
  }
}

function progressFromEvent(event: ProgressEvent, fallbackTotal: number): MediaUploadProgress {
  const total = event.lengthComputable ? event.total : fallbackTotal;
  const loaded = event.loaded;
  const percentage = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

  return { loaded, total, percentage };
}

export function uploadMedia(file: File, options: UploadMediaOptions = {}) {
  if (file.size === 0) {
    return Promise.reject(new MediaUploadError("Media file must not be empty."));
  }

  if (file.size > MEDIA_UPLOAD_MAX_SIZE_BYTES) {
    return Promise.reject(new MediaUploadError("Media must be 50 MB or smaller."));
  }

  if (!mediaTypeIsAllowed(file)) {
    return Promise.reject(new MediaUploadError("Only photos and videos can be uploaded."));
  }

  const {
    endpoint = MEDIA_UPLOAD_ENDPOINT,
    fieldName = MEDIA_UPLOAD_FIELD_NAME,
    signal,
    onProgress,
  } = options;

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", abortUpload);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const abortUpload = () => {
      xhr.abort();
      finish(() => reject(new MediaUploadError("Media upload was canceled.")));
    };

    if (signal?.aborted) {
      abortUpload();
      return;
    }

    xhr.open("POST", endpoint);
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      onProgress?.(progressFromEvent(event, file.size));
    };

    xhr.onload = () => {
      const payload = readUploadResponse(xhr);
      if (xhr.status >= 200 && xhr.status < 300 && typeof payload?.url === "string") {
        finish(() => resolve(payload.url as string));
        return;
      }

      finish(() =>
        reject(
          new MediaUploadError(
            uploadMessage(payload, `Media upload failed with status ${xhr.status}.`),
            xhr.status,
          ),
        ),
      );
    };

    xhr.onerror = () => {
      finish(() => reject(new MediaUploadError("Network error while uploading media.")));
    };

    xhr.onabort = () => {
      finish(() => reject(new MediaUploadError("Media upload was canceled.")));
    };

    signal?.addEventListener("abort", abortUpload, { once: true });

    const formData = new FormData();
    formData.append(fieldName, file);
    xhr.send(formData);
  });
}
