export type AuthorityInput = {
  documentImageDataUrl: string;
  fileName: string;
  imageQuality?: {
    width: number;
    height: number;
    sharpness: number;
    brightness: number;
    resolutionOk: boolean;
    blurLikely: boolean;
    brightnessStatus: "dark" | "balanced" | "bright";
  } | null;
  referenceFrames: string[];
  leftFrames: string[];
  rightFrames: string[];
  straightFrames: string[];
};

/**
 * Explicitly selects only raw evidence fields. This is defense in depth in
 * addition to the server-side schema validation: calculated decision/risk/
 * biometric/watchlist fields supplied by a browser are never forwarded to the
 * authoritative processing path.
 */
export function selectAuthoritativeInput(input: AuthorityInput): AuthorityInput {
  return {
    documentImageDataUrl: input.documentImageDataUrl,
    fileName: input.fileName,
    imageQuality: input.imageQuality ?? null,
    referenceFrames: [...input.referenceFrames],
    leftFrames: [...input.leftFrames],
    rightFrames: [...input.rightFrames],
    straightFrames: [...input.straightFrames],
  };
}
