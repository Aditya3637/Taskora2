/**
 * Client-side image handling for the notebook image block.
 *
 * Pages store their body as JSON in Postgres (no Storage bucket), so an
 * embedded image is kept as a compressed data URL inside the block. To
 * keep the autosaved body small we downscale to a max dimension and
 * re-encode. A screenshot that pastes in at ~1–3 MB lands around
 * 80–250 KB after this, which is fine for a handful of images per page.
 *
 * Copy-paste between notes is automatic: the data URL travels with the
 * block, so duplicating or re-pasting a block carries the image with it.
 */

const MAX_DIM = 1400; // longest edge, px
const JPEG_QUALITY = 0.82;
// Above this we always re-encode. Below it, small PNGs (e.g. logos with
// transparency) are kept as-is so we don't flatten their alpha channel.
const REENCODE_THRESHOLD_BYTES = 200 * 1024;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // reject absurd inputs

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

/** Rough byte size of a data URL's payload (base64 → bytes). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Compress an image file/blob to a compact data URL. Keeps small PNGs
 * untouched to preserve transparency; otherwise downscales and re-encodes
 * to JPEG. Throws on non-images or files over MAX_SOURCE_BYTES.
 */
export async function compressImageToDataUrl(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Image is too large (max 25 MB)");
  }

  const original = await readAsDataURL(file);

  // Keep small PNG/SVG/GIF as-is (transparency / animation preserved).
  const isLossless = file.type === "image/png" || file.type === "image/gif" || file.type === "image/svg+xml";
  if (isLossless && file.size <= REENCODE_THRESHOLD_BYTES) {
    return original;
  }
  // GIF/SVG can't be safely canvas-re-encoded without losing animation /
  // vector fidelity — pass through (size cap above still applies).
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return original;
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(original);
  } catch {
    return original; // decode failed — store what we have
  }

  const { width, height } = img;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, w, h);

  // PNGs with no real benefit from JPEG keep transparency; but anything
  // already large gets JPEG. We can't cheaply detect alpha, so prefer JPEG
  // for photos and large PNGs (the common screenshot case).
  const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // Guard: if JPEG somehow came out bigger, keep the original.
  return dataUrlBytes(out) < dataUrlBytes(original) ? out : original;
}

/** Pull the first image file out of a paste/drop, if any. */
export function imageFileFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  const files = dt.files ? Array.from(dt.files) : [];
  for (const f of files) {
    if (f.type.startsWith("image/")) return f;
  }
  return null;
}
