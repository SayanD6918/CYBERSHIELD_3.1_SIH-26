const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.78;
const MAX_BYTES = 10 * 1024 * 1024;

export async function prepareDocumentImage(file: File): Promise<{
  dataUrl: string;
  previewUrl: string;
  fileName: string;
}> {
  if (file.size > MAX_BYTES) {
    throw new Error("File is larger than 10 MB.");
  }

  if (file.type === "application/pdf") {
    throw new Error("Upload a PNG or JPG of the document page — PDFs are not scanned in this build.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload a PNG or JPG scan of the travel document.");
  }

  const bitmap = await createImageBitmap(file);
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
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { dataUrl, previewUrl: dataUrl, fileName: file.name };
}
