import "./reset.css";
import "water.css/out/dark.css";

let isRecording = false;
const startBtn = document.getElementById("start-record")!;
const stopBtn = document.getElementById("stop-record")!;
const statusEl = document.getElementById("mic-permission-status")!;

const updateStatus = (text: string) => {
  statusEl.textContent = text;
};

const requestMicrophoneAccess = async (): Promise<MediaStream | null> => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateStatus("このブラウザはマイク入力に対応していません。");
    return null;
  }

  try {
    updateStatus("マイクへのアクセスを要求しています…");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    updateStatus("マイクの使用が許可されました。");
    return stream;
  } catch (err) {
    updateStatus("マイクの使用が拒否されました、またはエラーが発生しました。");
    console.error("getUserMedia error:", err);
    return null;
  }
};

startBtn.addEventListener("click", async () => {
  const stream = await requestMicrophoneAccess();
  if (!stream) return;

  isRecording = true;
  startBtn.setAttribute("disabled", "true");
  stopBtn.removeAttribute("disabled")

  if (typeof MediaRecorder === "undefined") {
    updateStatus("このブラウザは録音に対応していません。");
    return;
  }

  const recordedChunks: BlobPart[] = [];

  // 最適な MIME タイプを選択
  const candidateMimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  let selectedMimeType = "";
  for (const mt of candidateMimeTypes) {
    if ((MediaRecorder as any).isTypeSupported?.(mt)) {
      selectedMimeType = mt;
      break;
    }
  }

  const mediaRecorder = selectedMimeType
    ? new MediaRecorder(stream, { mimeType: selectedMimeType })
    : new MediaRecorder(stream);

  mediaRecorder.addEventListener("dataavailable", (ev) => {
    if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
  });

  mediaRecorder.addEventListener("start", () => {
    updateStatus("録音中…");
  });

  mediaRecorder.addEventListener("stop", () => {
    const mime = selectedMimeType || "application/octet-stream";
    const blob = new Blob(recordedChunks, { type: mime });
    const url = URL.createObjectURL(blob);

    // 一時保存：window に保存して開発時に確認できるようにする
    (window as any).lastRecordingBlob = blob;
    (window as any).lastRecordingUrl = url;

    // ダウンロード用リンクを自動で作成（UI に表示したければカスタマイズ可能）
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording_${new Date().toISOString()}.${mime.includes("ogg") ? "ogg" : "webm"}`;
    a.textContent = "録音をダウンロード";
    a.style.display = "inline-block";
    a.style.marginLeft = "8px";
    document.body.appendChild(a);

    updateStatus("録音を一次保存しました。ダウンロードリンクを作成しました。");
  });

  mediaRecorder.start();

  // 停止ボタンで録音を停止し、UI を更新（リスナは一度だけ）
  stopBtn.addEventListener(
    "click",
    () => {
      if (!isRecording) return;
      mediaRecorder.stop();
      isRecording = false;
      startBtn.removeAttribute("disabled");
      stopBtn.setAttribute("disabled", "true");
    },
    { once: true }
  );
});
