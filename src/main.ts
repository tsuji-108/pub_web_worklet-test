import "./reset.css";
import "water.css/out/dark.css";
import { Mp3Encoder } from "@breezystack/lamejs";

let isRecording = false;
const startBtn = document.getElementById("start-record")!;
const stopBtn = document.getElementById("stop-record")!;
const statusEl = document.getElementById("status")!;
const audioEl = document.getElementById("audio")! as HTMLAudioElement;

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
  stopBtn.removeAttribute("disabled");

  try {
    if (!window.AudioWorklet) {
      updateStatus("このブラウザはAudioWorkletに対応していません。");
      return;
    }

    updateStatus("録音を開始します（AudioWorklet + MP3）…");

    const audioContext = new AudioContext();
    // AudioWorkletProcessor を Blob で作成してロード
    const workletCode = `
      class RecorderProcessor extends AudioWorkletProcessor {
        process (inputs) {
          const input = inputs[0];
          if (!input) return true;
          // input はチャネルごとの Float32Array の配列
          // postMessage でチャネル配列を転送する（構造化クローン）
          const channels = input.map(ch => ch.slice(0));
          this.port.postMessage(channels);
          return true;
        }
      }
      registerProcessor('recorder-processor', RecorderProcessor);
    `;
    const blob = new Blob([workletCode], { type: "application/javascript" });
    const moduleUrl = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(moduleUrl);
    URL.revokeObjectURL(moduleUrl);

    const source = audioContext.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audioContext, "recorder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: source.channelCount || 1,
    });
    source.connect(node); // ワークレットに入力を送る
    // node は出力を持たないので destination に接続しない（再生しない）

    const channels = source.channelCount || 1;
    const sampleRate = audioContext.sampleRate;
    const kbps = 128;
    const encoder = new Mp3Encoder(channels, sampleRate, kbps);

    const mp3Chunks: any[] = [];

    const floatTo16BitPCM = (input: Float32Array) => {
      const len = input.length;
      const buf = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return buf;
    };

    node.port.onmessage = (ev) => {
      // ev.data は Float32Array[] （各チャネル）
      const chanArr = ev.data as Float32Array[];
      if (!chanArr || chanArr.length === 0) return;

      if (chanArr.length === 1) {
        const left = floatTo16BitPCM(chanArr[0]);
        const mp3buf = encoder.encodeBuffer(left);
        if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
      } else {
        // stereo と仮定（左と右）
        const left = floatTo16BitPCM(chanArr[0]);
        const right = floatTo16BitPCM(chanArr[1] || chanArr[0]);
        const mp3buf = encoder.encodeBuffer(left, right);
        if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
      }
    };

    updateStatus("録音中（MP3 にエンコード中）…");

    // 停止ボタンで録音を停止し、MP3 を仕上げる
    stopBtn.addEventListener(
      "click",
      async () => {
        if (!isRecording) return;

        // 切断して AudioWorklet のメッセージを停止させる
        try {
          source.disconnect();
          node.port.close();
          node.disconnect?.();
        } catch (e) {
          // ignore
        }

        // finalize mp3
        const flushBuf = encoder.flush();
        if (flushBuf && flushBuf.length > 0) mp3Chunks.push(flushBuf);

        const mp3Blob = new Blob(mp3Chunks, { type: "audio/mpeg" });
        const url = URL.createObjectURL(mp3Blob);

        // window に一時保存（開発用）
        (window as any).lastRecordingBlob = mp3Blob;
        (window as any).lastRecordingUrl = url;

        audioEl.controls = true;
        audioEl.src = url;
        audioEl.style.display = "block";

        updateStatus(
          "録音を MP3 に変換して保存しました。audio 要素を追加しました。"
        );

        // UI 更新
        isRecording = false;
        startBtn.removeAttribute("disabled");
        stopBtn.setAttribute("disabled", "true");

        // 停止したら AudioContext を閉じる（不要リソース解放）
        try {
          await audioContext.close();
        } catch (e) {
          // ignore
        }
      },
      { once: true }
    );
  } catch (err) {
    console.error("MP3 エンコードの初期化に失敗しました:", err);
    updateStatus(
      "MP3 エンコードの初期化に失敗しました。ブラウザで lamejs が利用できることを確認してください。"
    );
  }
});
