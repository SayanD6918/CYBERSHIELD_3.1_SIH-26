const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.78;
const MAX_BYTES = 10 * 1024 * 1024;

export type DocumentImageQuality = {
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  resolutionOk: boolean;
  blurLikely: boolean;
  brightnessStatus: "dark" | "balanced" | "bright";
};

export type PreparedDocumentImage = {
  dataUrl: string;
  previewUrl: string;
  fileName: string;
  quality: DocumentImageQuality;
};

function assessCanvasQuality(canvas: HTMLCanvasElement): DocumentImageQuality {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      width: canvas.width,
      height: canvas.height,
      sharpness: 0,
      brightness: 0,
      resolutionOk: canvas.width >= 800 && canvas.height >= 600,
      blurLikely: true,
      brightnessStatus: "dark",
    };
  }

  const sampleWidth = Math.min(canvas.width, 512);
  const sampleHeight = Math.min(canvas.height, 512);
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) throw new Error("Could not assess image quality.");
  sampleCtx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);

  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = new Float32Array(sampleWidth * sampleHeight);
  let brightnessSum = 0;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    gray[p] = value;
    brightnessSum += value;
  }

  let varianceSum = 0;
  let count = 0;
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const i = y * sampleWidth + x;
      const laplacian =
        gray[i - 1] + gray[i + 1] + gray[i - sampleWidth] + gray[i + sampleWidth] - 4 * gray[i];
      varianceSum += laplacian * laplacian;
      count += 1;
    }
  }

  const sharpness = count ? varianceSum / count : 0;
  const brightness = pixels.length ? brightnessSum / (pixels.length / 4) : 0;

  return {
    width: canvas.width,
    height: canvas.height,
    sharpness: Math.round(sharpness * 100) / 100,
    brightness: Math.round(brightness * 100) / 100,
    resolutionOk: canvas.width >= 800 && canvas.height >= 600,
    blurLikely: sharpness < 45,
    brightnessStatus: brightness < 55 ? "dark" : brightness > 205 ? "bright" : "balanced",
  };
}

export async function prepareDocumentImage(file: File): Promise<PreparedDocumentImage> {
  if (file.size > MAX_BYTES) {
    throw new Error("File is larger than 10 MB.");
  }

  if (file.type === "application/pdf") {
    throw new Error("Upload a PNG or JPG of the document page — PDFs are not scanned in this build.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload a PNG or JPG scan of the travel document.");
  }

  let bitmap: ImageBitmap;
  try {
    // imageOrientation=from-image delegates EXIF orientation handling to the browser when supported.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not read this image.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const quality = assessCanvasQuality(canvas);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  return { dataUrl, previewUrl: dataUrl, fileName: file.name, quality };
}
