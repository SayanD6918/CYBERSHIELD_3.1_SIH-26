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
import { prepareDocumentImage } from "@/lib/document-image";
import { finalizeVerification } from "@/lib/finalize-verification";
import { useAppStore } from "@/lib/store";
import type { BiometricResult, CaseRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/verify")({
  component: VerifyPage,
});

const BIOMETRIC_URL = import.meta.env.VITE_BIOMETRIC_URL ?? "http://127.0.0.1:8765";

const CHALLENGES = [
  "Turn your head to the left",
  "Turn your head to the right",
  "Look straight at the camera",
];

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

  const [challenge] = useState(() => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]);

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

  async function runBiometric() {
    if (!pending || !payload || !caseId) {
      return;
    }

    setBiometricBusy(true);

    try {
      const liveFrame = captureFrame();

      const liveResponse = await fetch(`${BIOMETRIC_URL}/api/liveness`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_data_url: liveFrame,
        }),
      });

      if (!liveResponse.ok) {
        throw new Error("Liveness service unavailable.");
      }

      const live = await liveResponse.json();

      const matchResponse = await fetch(`${BIOMETRIC_URL}/api/face-match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_image_data_url: payload,
          live_image_data_url: liveFrame,
        }),
      });

      if (!matchResponse.ok) {
        throw new Error("Face-match service unavailable.");
      }

      const match = await matchResponse.json();

      const biometric: BiometricResult = {
        livenessStatus: live.liveness_status ?? "UNAVAILABLE",
        livenessConfidence: typeof live.confidence === "number" ? live.confidence : null,

        faceMatchStatus: match.face_match_status ?? "UNAVAILABLE",

        faceSimilarity: typeof match.similarity_score === "number" ? match.similarity_score : null,

        faceThreshold: Number(match.threshold ?? 0.8),

        challenge,
      };

      setBioResult(biometric);

      const finalized = finalizeVerification(pending, biometric);

      const created = addCase(
        {
          ...finalized,
          createdAt: new Date().toISOString(),
        },
        caseId,
      );

      setLatest(created);
      setPending(null);

      stopCamera();

      toast.success(`Verification complete · ${created.id}`);
    } catch (error) {
      console.error("Biometric verification error:", error);

      toast.error(error instanceof Error ? error.message : "Biometric verification failed.");
    } finally {
      setBiometricBusy(false);
    }
  }

  function runDemoScenario(kind: "valid" | "spoof" | "wrong-person" | "inconsistent") {
    const id = newCaseId();

    const common = {
      createdAt: new Date().toISOString(),
      fileName: `demo-${kind}.jpg`,
      documentType: "passport",
      documentNumber: kind === "valid" ? "P1234567" : "DEMO-0001",
      holderName: "Rahul Sharma",
      nationality: "Indian",
      dateOfBirth: "2001-05-14",
      expiryDate: "2031-05-14",
      watchlistHit: false,

      checks: [
        {
          id: "ocr",
          label: "OCR & data extraction",
          status: "passed" as const,
          detail: "98% confidence",
        },
        {
          id: "expiry",
          label: "Document expiry",
          status: "passed" as const,
          detail: "Valid",
        },
        {
          id: "tamper",
          label: "Tamper analysis",
          status: kind === "inconsistent" ? ("review" as const) : ("passed" as const),
          detail: kind === "inconsistent" ? "Field inconsistency simulated" : "No anomalies",
        },
      ],
    };

    const demo =
      kind === "spoof"
        ? {
            livenessStatus: "SPOOF" as const,
            livenessConfidence: 0.98,
            faceMatchStatus: "MATCH" as const,
            faceSimilarity: 0.94,
            faceThreshold: 0.8,
            challenge,
          }
        : kind === "wrong-person"
          ? {
              livenessStatus: "LIVE" as const,
              livenessConfidence: 0.96,
              faceMatchStatus: "NO_MATCH" as const,
              faceSimilarity: 0.42,
              faceThreshold: 0.8,
              challenge,
            }
          : {
              livenessStatus: "LIVE" as const,
              livenessConfidence: 0.97,
              faceMatchStatus: "MATCH" as const,
              faceSimilarity: 0.94,
              faceThreshold: 0.8,
              challenge,
            };

    const finalized = finalizeVerification(
      {
        ...common,
        riskScore: 0,
        decision: "safe",
        rationale: "Demo scenario",
        flags:
          kind === "spoof"
            ? ["DEMO MODE: spoof attack"]
            : kind === "wrong-person"
              ? ["DEMO MODE: wrong person"]
              : kind === "inconsistent"
                ? ["DEMO MODE: inconsistent identity"]
                : ["DEMO MODE"],
      },
      demo,
    );

    const created = addCase(
      {
        ...finalized,
        createdAt: common.createdAt,
      },
      id,
    );

    setLatest(created);
    setCaseId(id);

    toast.success(`DEMO MODE · ${created.decision.toUpperCase()}`);
  }

  function clearAll() {
    stopCamera();

    setFileName(null);
    setPreview(null);
    setPayload(null);
    setPending(null);
    setLatest(null);
    setBioResult(null);
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
              <div className="rounded-lg border bg-muted p-3 text-sm">
                <div className="font-semibold">Active challenge</div>

                <div className="mt-1 text-primary">“{challenge}”</div>

                <div className="mt-1 text-xs text-muted-foreground">
                  The bundled detector currently provides passive PAD; challenge completion is
                  operator guidance and is not counted as a passed signal.
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
                  ok={bioResult.livenessStatus === "LIVE"}
                  label="Liveness"
                  value={bioResult.livenessStatus}
                />

                <BioLine
                  ok={bioResult.faceMatchStatus === "MATCH"}
                  label="Face match"
                  value={
                    bioResult.faceSimilarity == null
                      ? bioResult.faceMatchStatus
                      : `${Math.round(bioResult.faceSimilarity * 100)}% similarity`
                  }
                />
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
                  <DecisionBadge decision={displayed.decision} />

                  <p className="mt-2 text-sm text-muted-foreground">
                    Risk score · {displayed.riskScore} / 100
                  </p>
                </div>
              </div>

              <div>
                <ScanChecks checks={displayed.checks} />

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

      <Card>
        <CardHeader>
          <CardTitle>DEMO MODE</CardTitle>

          <CardDescription>
            Clearly labeled simulated outcomes for the hackathon presentation.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => runDemoScenario("valid")}>
            Valid person
          </Button>

          <Button variant="outline" onClick={() => runDemoScenario("spoof")}>
            Spoof attack
          </Button>

          <Button variant="outline" onClick={() => runDemoScenario("wrong-person")}>
            Wrong person
          </Button>

          <Button variant="outline" onClick={() => runDemoScenario("inconsistent")}>
            Inconsistent identity
          </Button>
        </CardContent>
      </Card>
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
