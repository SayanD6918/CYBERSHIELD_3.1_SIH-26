import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Camera,
  CheckCircle2,
  FileImage,
  LoaderCircle,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DecisionBadge } from "@/components/decision-badge";
import { RiskRing } from "@/components/risk-ring";
import { ScanChecks } from "@/components/scan-checks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { analyzeDocument } from "@/lib/analyze-document";
import { prepareDocumentImage, type DocumentImageQuality } from "@/lib/document-image";
import { authoritativeVerification } from "@/lib/authoritative-verification";
import { useAppStore } from "@/lib/store";
import type { BiometricResult, CaseRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { titleCaseDocType } from "@/lib/format";

export const Route = createFileRoute("/_app/verify")({
  component: VerifyPage,
});

/**
 * The challenge sequence from the operating manual, performed in order.
 *
 * PASS 3D captures one neutral reference window first, then the three scripted
 * movements as one continuous server-verified challenge session.
 */
/** Submission mode: simple multi-frame live face capture. */
const LIVE_CAPTURE_FRAMES = 24;
const LIVE_CAPTURE_INTERVAL_MS = 100;
const REFERENCE_CAPTURE_FRAMES = 12;
const CHALLENGE_STEP_FRAMES = 16;
const CHALLENGE_INTERVAL_MS = 120;

function newCaseId() {
  const serial = String(Date.now()).slice(-6);
  return `CASE-2026-${serial}`;
}

function VerifyPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addCase = useAppStore((s) => s.addCase);
  const cases = useAppStore((s) => s.cases);
  const watchlist = useAppStore((s) => s.watchlist);
  const autoHold = useAppStore((s) => s.settings.autoHoldWatchlist);
  const hydrated = useAppStore((s) => s.hydrated);

  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [latest, setLatest] = useState<CaseRecord | null>(null);
  const [pending, setPending] = useState<Omit<CaseRecord, "id" | "createdAt"> | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [bioResult, setBioResult] = useState<BiometricResult | null>(null);
  const [documentQuality, setDocumentQuality] = useState<DocumentImageQuality | null>(null);

  const [captureState, setCaptureState] = useState<"READY" | "CAPTURING" | "COMPLETE" | "FAILED">("READY");
  const [captureProgress, setCaptureProgress] = useState(0);
  const [challengePhase, setChallengePhase] = useState<"READY" | "NEUTRAL" | "LEFT" | "RIGHT" | "STRAIGHT">("READY");

  const displayed = latest ?? cases[0] ?? null;

  /*
   * Attach the camera stream after React has rendered
   * the <video> element.
   */
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (!cameraOpen || !video || !stream) {
      return;
    }

    video.srcObject = stream;

    void video.play().catch((error) => {
      console.warn("Video autoplay/playback warning:", error);
    });
  }, [cameraOpen]);

  /*
   * Stop the camera when leaving the page.
   */
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function acceptFile(file: File) {
    try {
      const prepared = await prepareDocumentImage(file);

      setFileName(prepared.fileName);
      setPreview(prepared.previewUrl);
      setPayload(prepared.dataUrl);
      setDocumentQuality(prepared.quality);
      setPending(null);
      setBioResult(null);
      setLatest(null);
      setCaseId(null);

      // If a previous camera was running, stop it.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    }
  }

  async function runScan() {
    if (!payload || !fileName) {
      toast.error("Drop a document image first.");
      return;
    }

    setScanning(true);

    try {
      const result = await analyzeDocument({
        data: {
          imageDataUrl: payload,
          fileName,
          watchlistNames: watchlist.map((item) => item.name),
          autoHoldWatchlist: autoHold,
          imageQuality: documentQuality,
        },
      });

      const id = newCaseId();

      setCaseId(id);
      setPending(result.record);
      setBioResult(null);

      toast.success(`Document analysis complete · ${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  /*
   * Open the browser camera.
   *
   * The stream is stored first and cameraOpen is then set to true.
   * The useEffect above attaches the stream to the video element
   * after React renders it.
   */
  async function startCamera() {
    if (!pending || !payload) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera access is not supported by this browser or page.");
      return;
    }

    try {
      // Stop any existing stream before opening a new one.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraOpen(true);
      setBioResult(null);
      setCaptureState("READY");
      setCaptureProgress(0);

      toast.success("Camera connected.");
    } catch (error) {
      console.error("Camera error:", error);

      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          toast.error(
            "Camera permission was denied. Allow camera access for localhost and try again.",
          );
        } else if (error.name === "NotFoundError") {
          toast.error("No camera was found on this device.");
        } else if (error.name === "NotReadableError") {
          toast.error("The camera is already being used by another application.");
        } else {
          toast.error(`Camera error: ${error.name}`);
        }
      } else {
        toast.error("Camera unavailable. Check browser permission and camera connection.");
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);
    setCaptureProgress(0);
  }

  async function waitForNextVideoFrame(video: HTMLVideoElement) {
    const frameAwareVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };

    if (typeof frameAwareVideo.requestVideoFrameCallback === "function") {
      await new Promise<void>((resolve) => {
        frameAwareVideo.requestVideoFrameCallback?.(() => resolve());
      });
      return;
    }

    // Compatibility fallback for browsers without requestVideoFrameCallback.
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  async function captureBurst(frameCount = 8, intervalMs = 120) {
    const frames: string[] = [];
    setCaptureProgress(0);
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !stream.active || !stream.getVideoTracks().some((track) => track.readyState === "live")) {
      throw new Error("Camera stream is not active. Reopen the camera and try again.");
    }
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error("Camera video is not ready yet. Wait for the preview and try again.");
    }
    for (let i = 0; i < frameCount; i += 1) {
      // Synchronize capture with the browser's decoded camera frames. A fixed
      // timeout can capture the same decoded frame twice, which the server
      // correctly treats as suspicious replay evidence.
      await waitForNextVideoFrame(video);

      const frame = captureFrame();
      if (!frame.startsWith("data:image/jpeg;base64,")) {
        throw new Error(`Captured frame ${i + 1} is not a valid JPEG data URL.`);
      }
      frames.push(frame);
      setCaptureProgress(i + 1);
      if (i < frameCount - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
      }
    }
    return frames;
  }

  function captureFrame() {
    const video = videoRef.current;

    if (!video) {
      throw new Error("Camera video element is unavailable.");
    }

    if (video.readyState < 2) {
      throw new Error("Camera is not ready. Please wait a moment.");
    }

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Camera video has no usable frame yet.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create camera capture canvas.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.82);
  }

  /**
   * Capture a short live-camera burst before submitting it for face matching.
   */
  async function captureLiveVerificationBurst() {
    setCaptureState("CAPTURING");
    const frames = await captureBurst(LIVE_CAPTURE_FRAMES, LIVE_CAPTURE_INTERVAL_MS);
    setCaptureState("COMPLETE");
    return frames;
  }

  async function runBiometric() {
    if (!pending || !payload || !caseId) return;
    setBiometricBusy(true);
    setCaptureState("CAPTURING");
    setCaptureProgress(0);
    try {
      // Raw camera/document evidence crosses the application server boundary.
      // The browser does not send a biometric result, risk score, decision or
      // watchlist hit for the server to trust.
      setChallengePhase("NEUTRAL");
      const referenceFrames = await captureBurst(REFERENCE_CAPTURE_FRAMES, CHALLENGE_INTERVAL_MS);

      setChallengePhase("LEFT");
      toast.info("Reference captured. Turn your head LEFT when prompted.");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const leftFrames = await captureBurst(CHALLENGE_STEP_FRAMES, CHALLENGE_INTERVAL_MS);

      setChallengePhase("RIGHT");
      toast.info("Now turn your head RIGHT.");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const rightFrames = await captureBurst(CHALLENGE_STEP_FRAMES, CHALLENGE_INTERVAL_MS);

      setChallengePhase("STRAIGHT");
      toast.info("Now look STRAIGHT and hold still.");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const straightFrames = await captureBurst(CHALLENGE_STEP_FRAMES, CHALLENGE_INTERVAL_MS);

      const result = await authoritativeVerification({
        data: {
          documentImageDataUrl: payload,
          fileName: pending.fileName,
          imageQuality: documentQuality,
          referenceFrames,
          leftFrames,
          rightFrames,
          straightFrames,
        },
      });

      const created = result.record as CaseRecord;
      setBioResult(created.biometric ?? null);
      setChallengePhase("READY");
      addCase(created, created.id);
      setLatest(created);
      setPending(null);
      stopCamera();

      toast.success(`Verification complete · ${created.id}`);
    } catch (error) {
      console.error("Authoritative verification error:", error);
      setCaptureState("FAILED");
      setChallengePhase("READY");
      toast.error(error instanceof Error ? error.message : "Authoritative verification failed.");
    } finally {
      setBiometricBusy(false);
    }
  }

  function clearAll() {
    stopCamera();

    setFileName(null);
    setPreview(null);
    setPayload(null);
    setPending(null);
    setLatest(null);
    setBioResult(null);
    setCaptureState("READY");
    setCaptureProgress(0);
    setChallengePhase("READY");
    setCaseId(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">CYBERSHIELD 3.1</span>
        </div>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Intelligent Identity Verification Gateway
        </h1>

        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Document authenticity → identity consistency → liveness → face verification → explainable
          risk. Prototype results are for demonstration only.
        </p>
      </div>

      {caseId ? (
        <div className="rounded-lg border bg-muted px-4 py-3 font-mono text-sm">
          CASE ID · {caseId}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>1 · Document capture</CardTitle>
            <CardDescription>
              PNG/JPG/WebP · maximum 10 MB · biodata page works best.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);

                const file = e.dataTransfer.files[0];

                if (file) {
                  void acceptFile(file);
                }
              }}
              className={cn(
                "rounded-xl bg-muted px-6 py-10 text-center transition",
                dragging && "bg-accent",
              )}
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Selected identity document"
                  className="mx-auto max-h-48 rounded-lg object-contain outline outline-1 -outline-offset-1 outline-foreground/10"
                />
              ) : (
                <div className="mx-auto grid size-12 place-items-center rounded-lg bg-secondary text-primary">
                  <Upload className="size-5" />
                </div>
              )}

              <p className="mt-4 text-sm font-medium">
                {fileName ?? "Drop passport, visa, permit, Aadhaar (UIDAI), or ID here"}
              </p>

              <Button
                type="button"
                variant="secondary"
                className="mt-5"
                onClick={() => inputRef.current?.click()}
              >
                <FileImage />
                Browse files
              </Button>

              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];

                  if (file) {
                    void acceptFile(file);
                  }
                }}
              />
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() => void runScan()}
                disabled={scanning || !payload}
              >
                {scanning ? <LoaderCircle className="animate-spin" /> : <ArrowIcon />}

                {scanning ? "Analyzing document…" : "Analyze document"}
              </Button>

              <Button variant="outline" disabled={scanning || !fileName} onClick={clearAll}>
                <XCircle />
                Clear
              </Button>
            </div>

            {pending ? (
              <div className="rounded-lg border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Document analysis complete
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Field label="Type" value={titleCaseDocType(pending.documentType)} />

                  <Field label="Document" value={pending.documentNumber} />

                  <Field label="Holder" value={pending.holderName ?? "Not extracted"} />

                  <Field label="Expiry" value={pending.expiryDate ?? "Unknown"} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>2 · Biometric verification</CardTitle>
            <CardDescription>Camera opens only after document analysis.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!cameraOpen ? (
              <Button className="w-full" disabled={!pending} onClick={() => void startCamera()}>
                <Camera />
                Open secure camera
              </Button>
            ) : null}

            {cameraOpen ? (
              <div className="overflow-hidden rounded-xl bg-black">
                <video
                  ref={videoRef}
                  muted
                  autoPlay
                  playsInline
                  className="aspect-video w-full object-cover"
                />
              </div>
            ) : null}

            {cameraOpen ? (
                            <div className="space-y-3 rounded-lg border bg-muted p-3 text-sm">
                <div>
                  <div className="font-semibold">Live biometric verification</div>
                  <div className="mt-1 text-xs text-muted-foreground">The session now verifies document face matching, passive PAD, and the existing PASS3D challenge. Follow the prompts: neutral → left → right → straight.</div>
                </div>
                <div className="rounded-md bg-background px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide">Capture state</span>
                    <span className={cn("font-semibold", captureState === "COMPLETE" ? "text-success" : captureState === "FAILED" ? "text-destructive" : "text-primary")}>{captureState}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{captureState === "CAPTURING" ? `Collecting biometric evidence… ${captureProgress} frames in the current phase` : "Production verification uses SFace face matching, passive PAD, and the server-verified PASS3D challenge."}</div>
                </div>

                {biometricBusy ? (
                  <div className="rounded-md border bg-background px-3 py-3 text-center">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active challenge</div>
                    <div className="mt-1 text-lg font-bold text-primary">
                      {challengePhase === "NEUTRAL" && "LOOK STRAIGHT"}
                      {challengePhase === "LEFT" && "← TURN LEFT"}
                      {challengePhase === "RIGHT" && "TURN RIGHT →"}
                      {challengePhase === "STRAIGHT" && "LOOK STRAIGHT · HOLD STILL"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Follow the instruction while keeping one face clearly visible.</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {cameraOpen ? (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  disabled={biometricBusy}
                  onClick={() => void runBiometric()}
                >
                  {biometricBusy ? <LoaderCircle className="animate-spin" /> : <Camera />}

                  {biometricBusy ? "Checking…" : "Capture & verify person"}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={biometricBusy}
                  onClick={stopCamera}
                >
                  <XCircle />
                  Close camera
                </Button>
              </div>
            ) : null}

            {bioResult ? (
              <div className="grid gap-2 text-sm">
                <BioLine
                  ok={bioResult.liveCaptureStatus === "CAPTURED"}
                  label="Live face capture"
                  value={bioResult.liveCaptureStatus ?? "UNCERTAIN"}
                />

                <BioLine
                  ok={bioResult.faceMatchStatus === "MATCH"}
                  label="Face match"
                  value={
                    bioResult.faceSimilarity == null
                      ? bioResult.faceMatchStatus
                      : `${bioResult.faceMatchStatus} · similarity ${bioResult.faceSimilarity.toFixed(4)}`
                  }
                />

                {bioResult.evidence?.face ? (
                  <div className="rounded-lg border bg-muted p-3 text-xs">
                    <div className="font-semibold">Face comparison diagnostics</div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      <div>Document: <span className="font-mono">{bioResult.evidence.face.measurements?.documentType ?? "unknown"}</span></div>
                      <div>Portrait: <span className="font-mono">{bioResult.evidence.face.measurements?.portraitDetected ? "DETECTED" : "NOT_DETECTED"}</span></div>
                      <div>Document face: <span className="font-mono">{bioResult.evidence.face.measurements?.documentFaceDetected ? "DETECTED" : "NOT_DETECTED"}</span></div>
                      <div>Document embedding: <span className="font-mono">{bioResult.evidence.face.measurements?.documentEmbeddingGenerated ? "READY" : "NOT_READY"}</span></div>
                      <div>Live face: <span className="font-mono">{bioResult.evidence.face.measurements?.liveFaceDetected ? "DETECTED" : "NOT_DETECTED"}</span></div>
                      <div>Live embedding: <span className="font-mono">{bioResult.evidence.face.measurements?.liveEmbeddingGenerated ? "READY" : "NOT_READY"}</span></div>
                      <div>Metric: <span className="font-mono">{bioResult.evidence.face.metric ?? "unknown"}</span></div>
                      <div>Biometric Similarity: <span className="font-mono">{bioResult.faceSimilarity == null ? "NOT AVAILABLE" : bioResult.faceSimilarity.toFixed(6)}</span></div>
                      <div>Threshold: <span className="font-mono">{bioResult.evidence.face.threshold == null ? "—" : bioResult.evidence.face.threshold.toFixed(3)}</span></div>
                      <div>Uncertainty band: <span className="font-mono">{bioResult.evidence.face.uncertainBand == null ? "—" : bioResult.evidence.face.uncertainBand.toFixed(3)}</span></div>
                      <div>Live faces: <span className="font-mono">{bioResult.evidence.face.measurements?.liveFaceCount ?? "—"}</span></div>
                      <div>Frames received: <span className="font-mono">{bioResult.evidence.face.measurements?.framesReceived ?? "—"}</span></div>
                      <div>Frames with face: <span className="font-mono">{bioResult.evidence.face.measurements?.framesWithFace ?? "—"}</span></div>
                      <div>Selected frame: <span className="font-mono">{bioResult.evidence.face.measurements?.selectedLiveFrame ?? "—"}</span></div>
                    </div>
                    {bioResult.evidence.face.issues.length > 0 ? (
                      <div className="mt-2 text-destructive">Issues: {bioResult.evidence.face.issues.join("; ")}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>3 · Final assessment</CardTitle>

          <CardDescription>
            {displayed
              ? `${displayed.id}${
                  hydrated ? ` · ${new Date(displayed.createdAt).toLocaleString()}` : ""
                }`
              : "Complete the workflow to populate the decision."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {displayed ? (
            <div className="grid gap-5 md:grid-cols-[auto_1fr]">
              <div className="flex items-center gap-4">
                <RiskRing score={displayed.riskScore} decision={displayed.decision} />

                <div>
                  <DecisionBadge decision={displayed.decision} finalDecision={displayed.finalDecision} />

                  <p className="mt-2 text-sm text-muted-foreground">
                    Risk score · {displayed.riskScore} / 100
                  </p>
                </div>
              </div>

              <div>
                <ScanChecks checks={displayed.checks} />

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <EvidenceCard label="Document status" value={displayed.evidence?.document?.status ?? "unknown"} />
                  <EvidenceCard label="MRZ status" value={displayed.evidence?.mrz?.status ?? "unknown"} />
                  <EvidenceCard
                    label="Document quality"
                    value={displayed.evidence?.document?.quality?.resolutionOk === false ? "review" : displayed.evidence?.document?.quality ? "evaluated" : "unavailable"}
                  />
                  <EvidenceCard
                    label="Face match"
                    value={displayed.biometric?.faceMatchStatus ?? "UNAVAILABLE"}
                    detail={displayed.biometric?.faceSimilarity == null ? undefined : `similarity ${displayed.biometric.faceSimilarity.toFixed(4)} · distance ${displayed.evidence?.face?.distance?.toFixed(4) ?? "—"}`}
                  />
                  <EvidenceCard label="Live face capture" value={displayed.biometric?.liveCaptureStatus ?? "UNCERTAIN"} />
                  <EvidenceCard label="Identity record" value={displayed.evidence?.identity?.provider ?? "UNVERIFIED"} detail={displayed.evidence?.identity?.authoritative ? "authoritative" : "not authoritative"} />
                  <EvidenceCard label="Watchlist" value={displayed.watchlistHit ? "MATCH" : "CLEAR"} />
                  <EvidenceCard label="Final risk" value={`${displayed.riskScore} / 100`} />
                </div>

                <p className="mt-4 text-sm text-muted-foreground">{displayed.rationale}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run document analysis, then biometric verification, to produce a final GREEN / YELLOW
              / RED assessment.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function EvidenceCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border bg-muted/50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>

      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function BioLine({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
      <span>{label}</span>

      <span
        className={cn("flex items-center gap-1 font-medium", ok ? "text-success" : "text-warning")}
      >
        {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}

        {value}
      </span>
    </div>
  );
}

function ArrowIcon() {
  return <span aria-hidden="true">→</span>;
}
