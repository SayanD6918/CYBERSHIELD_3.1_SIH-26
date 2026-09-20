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
import { finalizeVerification } from "@/lib/finalize-verification";
import { useAppStore } from "@/lib/store";
import type { BiometricResult, CaseRecord, FaceEvidence } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/verify")({
  component: VerifyPage,
});

const BIOMETRIC_URL = import.meta.env.VITE_BIOMETRIC_URL ?? "http://127.0.0.1:8765";

/**
 * The challenge sequence from the operating manual, performed in order.
 *
 * Three scripted movements are materially harder to replay than one, and
 * ending on LOOK_STRAIGHT means the burst always finishes with frontal
 * frames - which is what the face matcher wants.
 */
const CHALLENGE_SEQUENCE = [
  {
    action: "TURN_LEFT",
    label: "Turn your head to the left",
    hint: "Start facing the camera, turn left, and hold it.",
  },
  {
    action: "TURN_RIGHT",
    label: "Turn your head to the right",
    hint: "Come back through centre, turn right, and hold it.",
  },
  {
    action: "LOOK_STRAIGHT",
    label: "Look straight at the camera",
    hint: "Return to a straight, centred pose and hold it.",
  },
] as const;

type ChallengeStep = (typeof CHALLENGE_SEQUENCE)[number];

type ChallengeStepResult = {
  action: string;
  label: string;
  status: "PASSED" | "FAILED";
  failureReason: string | null;
  confidence: number | null;
  initialPose: { yaw: number; pitch: number; roll: number } | null;
  observedPose: { yaw: number; pitch: number; roll: number } | null;
  movementDetected: boolean;
  validPoseFrames: number;
};

const FRAMES_PER_STEP = 16;
const FRAME_INTERVAL_MS = 130;

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

  const [challengeState, setChallengeState] = useState<"READY" | "CAPTURING" | "PASSED" | "FAILED">("READY");
  const [activeStep, setActiveStep] = useState<ChallengeStep | null>(null);
  const [stepResults, setStepResults] = useState<ChallengeStepResult[]>([]);

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
      setChallengeState("READY");

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
  }

  async function captureBurst(frameCount = 8, intervalMs = 120) {
    const frames: string[] = [];
    for (let i = 0; i < frameCount; i += 1) {
      frames.push(captureFrame());
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

  async function postJson(path: string, body: unknown) {
    const response = await fetch(`${BIOMETRIC_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Biometric service returned ${response.status} for ${path}.`);
    }
    return response.json();
  }

  /**
   * Walk the challenge sequence, then score liveness and the face match.
   *
   * Every step's frames are kept: passive PAD sees the whole session, and
   * the face matcher receives the burst rather than a single still, so the
   * service can pick the most frontal frame itself.
   */
  async function runChallengeSequence() {
    const results: ChallengeStepResult[] = [];
    const allFrames: string[] = [];
    const frontalFrames: string[] = [];

    for (const step of CHALLENGE_SEQUENCE) {
      setActiveStep(step);
      const frames = await captureBurst(FRAMES_PER_STEP, FRAME_INTERVAL_MS);
      allFrames.push(...frames);

      if (step.action === "LOOK_STRAIGHT") {
        frontalFrames.push(...frames);
      }

      const active = await postJson("/api/active-challenge", {
        challenge: step.action,
        frames_data_urls: frames,
      });

      const result: ChallengeStepResult = {
        action: step.action,
        label: step.label,
        status: active.challenge_status === "PASSED" ? "PASSED" : "FAILED",
        failureReason: active.failure_reason ?? null,
        confidence: typeof active.confidence === "number" ? active.confidence : null,
        initialPose: active.initial_pose ?? null,
        observedPose: active.observed_pose ?? null,
        movementDetected: active.movement_detected === true,
        validPoseFrames: active.evidence?.valid_pose_frames ?? 0,
      };

      results.push(result);
      setStepResults([...results]);
    }

    setActiveStep(null);
    return { results, allFrames, frontalFrames };
  }

  async function runBiometric() {
    if (!pending || !payload || !caseId) {
      return;
    }

    setBiometricBusy(true);
    setChallengeState("CAPTURING");
    setStepResults([]);

    try {
      const { results, allFrames, frontalFrames } = await runChallengeSequence();

      const sequencePassed = results.every((step) => step.status === "PASSED");
      const firstFailure = results.find((step) => step.status === "FAILED");
      setChallengeState(sequencePassed ? "PASSED" : "FAILED");

      const live = await postJson("/api/liveness", { frames_data_urls: allFrames });

      // Prefer the frames captured while the subject was asked to face the
      // camera; fall back to the whole burst if that step produced none.
      const match = await postJson("/api/face-match", {
        document_image_data_url: payload,
        live_frames_data_urls: frontalFrames.length > 0 ? frontalFrames : allFrames,
      });

      const faceSimilarity =
        typeof match.similarity_score === "number" ? match.similarity_score : null;
      const faceThreshold = typeof match.threshold === "number" ? match.threshold : null;

      const faceEvidence: FaceEvidence = {
        status:
          match.face_match_status === "MATCH"
            ? "passed"
            : match.face_match_status === "NO_MATCH"
              ? "fail"
              : "review",
        // Cosine similarity is not a confidence, and pretending otherwise
        // is exactly the misreading this field invites.
        confidence: null,
        method: match.matcher ?? "sface-embedding",
        issues: Array.isArray(match.issues) ? match.issues : [],
        similarity: faceSimilarity,
        distance: typeof match.distance === "number" ? match.distance : null,
        threshold: faceThreshold,
        uncertainBand: typeof match.uncertain_band === "number" ? match.uncertain_band : null,
        metric: match.metric ?? "cosine_similarity",
        model: match.model ?? null,
        modelVersion: match.model_version ?? null,
        calibrated: match.calibrated === true,
        source: "comparison" as const,
        measurements: {
          documentPortrait: match.document_portrait ? JSON.stringify(match.document_portrait) : null,
          documentFace: match.document_face ? JSON.stringify(match.document_face) : null,
          liveFace: match.live_face ? JSON.stringify(match.live_face) : null,
          probeFrame: match.probe_frame ? JSON.stringify(match.probe_frame) : null,
          documentEmbeddingGenerated: Boolean(match.document_face),
          liveEmbeddingGenerated: Boolean(match.live_face),
        },
      };

      const livenessStatus = live.liveness_status ?? "UNAVAILABLE";
      const livenessConfidence = typeof live.confidence === "number" ? live.confidence : null;
      // These live under evidence.* in the service response; reading them
      // from the top level silently produced nulls on every case.
      const spoofProbability =
        typeof live.evidence?.pad?.spoof_probability_median === "number"
          ? live.evidence.pad.spoof_probability_median
          : null;
      const framesAnalyzed =
        typeof live.evidence?.frames_analyzed === "number" ? live.evidence.frames_analyzed : null;

      const biometric: BiometricResult = {
        provenance: "REAL",
        livenessStatus,
        livenessConfidence,
        faceMatchStatus: match.face_match_status ?? "UNAVAILABLE",
        faceSimilarity,
        faceThreshold: faceThreshold ?? 0,
        challenge: CHALLENGE_SEQUENCE.map((step) => step.label).join(" → "),
        evidence: {
          face: faceEvidence,
          liveness: {
            status:
              livenessStatus === "LIVE" ? "passed" : livenessStatus === "SPOOF" ? "fail" : "review",
            confidence: livenessConfidence,
            method: live.model ?? "passive PAD",
            issues: Array.isArray(live.issues) ? live.issues : [],
            livenessConfidence,
            spoofProbability,
            source: "passive",
            measurements: {
              framesAnalyzed,
              faceCrops:
                typeof live.evidence?.face_crops === "number" ? live.evidence.face_crops : null,
              model: live.model ?? null,
              modelVersion: live.model_version ?? null,
              featureVersion: live.feature_version ?? null,
              calibrated: live.calibrated === true,
              quality: live.quality ? JSON.stringify(live.quality) : null,
            },
          },
          challenge: {
            status: sequencePassed ? "passed" : "fail",
            confidence: results.length
              ? Math.min(...results.map((step) => step.confidence ?? 0))
              : null,
            method: "YuNet-5-landmark + solvePnP(SQPNP), three-step sequence",
            issues: results
              .filter((step) => step.failureReason)
              .map((step) => `${step.action}: ${step.failureReason}`),
            source: "active",
            challenge: CHALLENGE_SEQUENCE.map((step) => step.label).join(" → "),
            completed: sequencePassed,
            requestedAction: CHALLENGE_SEQUENCE.map((step) => step.action).join(","),
            initialPose: results[0]?.initialPose ?? null,
            observedPose: results[results.length - 1]?.observedPose ?? null,
            movementDetected: results.some((step) => step.movementDetected),
            challengeStatus: sequencePassed ? "PASSED" : "FAILED",
            failureReason: firstFailure
              ? `${firstFailure.action}: ${firstFailure.failureReason ?? "FAILED"}`
              : null,
            measurements: {
              stepsRequested: CHALLENGE_SEQUENCE.length,
              stepsPassed: results.filter((step) => step.status === "PASSED").length,
              validPoseFrames: results.reduce((total, step) => total + step.validPoseFrames, 0),
              framesCaptured: allFrames.length,
            },
          },
        },
      };

      setBioResult(biometric);

      const finalized = finalizeVerification(pending, biometric, {
        autoHoldWatchlist: autoHold,
      });

      const created = addCase(
        { ...finalized, createdAt: new Date().toISOString() },
        caseId,
      );

      setLatest(created);
      setPending(null);
      stopCamera();

      toast.success(`Verification complete · ${created.id}`);
    } catch (error) {
      console.error("Biometric verification error:", error);
      setActiveStep(null);
      setChallengeState("FAILED");
      toast.error(error instanceof Error ? error.message : "Biometric verification failed.");
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
    setChallengeState("READY");
    setActiveStep(null);
    setStepResults([]);
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
                {fileName ?? "Drop passport, visa, permit, or ID here"}
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
                  <Field label="Type" value={pending.documentType} />

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
                  <div className="font-semibold">Active liveness challenge</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Three movements, in order. Each one is verified from head
                    pose on the server.
                  </div>
                </div>

                <ol className="space-y-1.5">
                  {CHALLENGE_SEQUENCE.map((step, index) => {
                    const result = stepResults.find((item) => item.action === step.action);
                    const running = activeStep?.action === step.action;
                    return (
                      <li
                        key={step.action}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-2 py-1.5",
                          running && "bg-background",
                        )}
                      >
                        <span className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block",
                              running ? "font-semibold text-primary" : "text-foreground",
                            )}
                          >
                            {step.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {running ? step.hint : result?.failureReason ?? step.hint}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 text-xs font-semibold",
                            result?.status === "PASSED"
                              ? "text-success"
                              : result?.status === "FAILED"
                                ? "text-destructive"
                                : "text-muted-foreground",
                          )}
                        >
                          {result?.status ?? (running ? "…" : "—")}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <div className="flex items-center justify-between rounded-md bg-background px-3 py-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Sequence state</span>
                  <span
                    className={cn(
                      "font-semibold",
                      challengeState === "PASSED"
                        ? "text-success"
                        : challengeState === "FAILED"
                          ? "text-destructive"
                          : "text-primary",
                    )}
                  >
                    {challengeState}
                  </span>
                </div>

                <div className="border-t pt-3">
                  <div className="font-semibold">Passive liveness</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Presentation-attack detection runs over the frames from all
                    three steps, independently of whether the movements passed.
                  </div>
                </div>
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
                  ok={bioResult.evidence?.challenge?.challengeStatus === "PASSED"}
                  label="Active challenge"
                  value={
                    bioResult.evidence?.challenge?.challengeStatus === "PASSED"
                      ? "PASSED"
                      : bioResult.evidence?.challenge?.failureReason ?? "FAILED"
                  }
                />

                <BioLine
                  ok={bioResult.livenessStatus === "LIVE"}
                  label="Passive liveness"
                  value={bioResult.livenessStatus}
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

                {stepResults.length > 0 ? (
                  <div className="rounded-lg border bg-muted p-3 text-xs">
                    <div className="font-semibold">Challenge evidence</div>
                    <div className="mt-2 space-y-1.5">
                      {stepResults.map((step) => (
                        <div key={step.action} className="flex items-baseline justify-between gap-3">
                          <span className="font-mono">{step.action}</span>
                          <span className="text-muted-foreground">
                            {step.observedPose
                              ? `yaw ${step.observedPose.yaw}° · pitch ${step.observedPose.pitch}°`
                              : step.failureReason ?? "no pose"}
                          </span>
                          <span
                            className={
                              step.status === "PASSED" ? "text-success" : "text-destructive"
                            }
                          >
                            {step.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-muted-foreground">
                      Yaw is an uncalibrated model-relative angle, not a measured head angle.
                    </div>
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
                  <EvidenceCard label="Passive liveness" value={displayed.biometric?.livenessStatus ?? "UNAVAILABLE"} detail={displayed.biometric?.livenessConfidence == null ? undefined : `${Math.round(displayed.biometric.livenessConfidence * 100)}% confidence`} />
                  <EvidenceCard label="Active challenge" value={displayed.evidence?.challenge?.challengeStatus ?? "NOT_RUN"} />
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
