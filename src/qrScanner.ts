import jsQR from "jsqr";

export function parseCandidateQrPayload(rawValue: string): string {
  const raw = String(rawValue || "").trim();
  if (!raw) throw new Error("The QR code was empty.");
  try {
    const scannedUrl = new URL(raw);
    const candidateId = scannedUrl.searchParams.get("candidate") || "";
    if (candidateId) return candidateId;
  } catch {
    // Not a URL; the QR may contain the compact JSON payload used offline.
  }
  try {
    const candidateId = String(JSON.parse(raw).candidate_id || "").trim();
    if (candidateId) return candidateId;
  } catch {
    // The caller receives one consistent error below.
  }
  throw new Error("That is not a Barry candidate QR code.");
}

async function decodeVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string> {
  const Detector = (window as any).BarcodeDetector;
  if (Detector) {
    const codes = await new Detector({ formats: ["qr_code"] }).detect(video);
    if (codes[0]?.rawValue) return codes[0].rawValue;
  }
  if (!video.videoWidth || !video.videoHeight) return "";
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height)?.data || "";
}

export async function startCandidateQrCamera({
  video,
  onCandidate,
  onStatus,
}: {
  video: HTMLVideoElement;
  onCandidate: (candidateId: string) => void | Promise<void>;
  onStatus?: (message: string) => void;
}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera scanning is not supported in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();
  let stopped = false;
  let frame = 0;
  const canvas = document.createElement("canvas");
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const scan = async () => {
    if (stopped) return;
    try {
      const rawValue = await decodeVideoFrame(video, canvas);
      if (rawValue) {
        const candidateId = parseCandidateQrPayload(rawValue);
        stop();
        await onCandidate(candidateId);
        onStatus?.("Candidate loaded");
        return;
      }
    } catch (error: any) {
      if (error?.message?.includes("Barry candidate")) onStatus?.(error.message);
    }
    frame = requestAnimationFrame(scan);
  };
  onStatus?.("Camera ready — point it at the candidate QR code.");
  frame = requestAnimationFrame(scan);
  return { stop };
}
