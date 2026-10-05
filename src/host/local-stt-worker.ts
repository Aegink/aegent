/**
 * 本地 SenseVoice 转写——worker 子进程入口（T-P3-174 批次 6 G1；dsh
 * process 隔离同构的最小面）：原生崩溃不带走 host、CPU 推理串行化。
 * 协议 = stdin/stdout JSON 行（dsh 用 loopback HTTP 是为取消 terminate——
 * 我方 V1 串行队列一次一请求，行协议足够且少一个端口面）：
 *   host → worker：{"id":"r1","audioBase64":"...","language":"zh"}
 *   worker → host：{"ready":true}（启动完成信号）
 *                  {"id":"r1","ok":true,"text":"..."} / {"id":"r1","ok":false,"code":"...","message":"..."}
 * 音频 = 44 字节头 16kHz 单声道 PCM16 WAV（dsh wave.ts 同规范——sherpa
 * featConfig 16k 固定）；PCM16 → Float32 /32768 后喂 Silero VAD 分段，
 * 逐段 OfflineRecognizer.decode 拼接。
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** dsh inference.ts 同款类型面（sherpa-onnx-node 无声明文件——CJS require）。 */
interface Stream {
  acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
}
interface Recognizer {
  createStream(): Stream;
  setConfig(config: object): void;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
}
interface Detector {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(externalBuffer: false): { samples: Float32Array };
  pop(): void;
  reset(): void;
  flush(): void;
}
interface Sherpa {
  OfflineRecognizer: new (config: object) => Recognizer;
  Vad: new (config: object, bufferSeconds: number) => Detector;
}

export interface LocalSttWorkerConfig {
  modelPath: string;
  tokensPath: string;
  vadPath: string;
  threads: number;
  /** VAD 分段上限秒（dsh segmentSeconds 缺省 30）。 */
  segmentSeconds: number;
  maxAudioBytes: number;
}

const DEFAULTS = { threads: 2, segmentSeconds: 30, maxAudioBytes: 8 * 1024 * 1024 };

/** WAV → Float32 样本（剥 44 字节头，PCM16 LE /32768——dsh inference 同式）。 */
export function wavPcm16ToSamples(audio: Uint8Array): Float32Array {
  const pcm = new DataView(audio.buffer, audio.byteOffset + 44, audio.byteLength - 44);
  return Float32Array.from({ length: Math.floor(pcm.byteLength / 2) }, (_, i) => pcm.getInt16(i * 2, true) / 32768);
}

/** 形状校验（RIFF/WAVE 头 + 16k/mono/16bit——触碰原生前 fail-closed）。 */
export function validateWav(audio: Uint8Array, maxAudioBytes: number): string | undefined {
  if (audio.byteLength < 46) return "音频过短（非 WAV）";
  if (audio.byteLength > maxAudioBytes) return `音频超上限（${audio.byteLength} > ${maxAudioBytes}）`;
  const ascii = (off: number, len: number): string => String.fromCharCode(...audio.subarray(off, off + len));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return "不是 WAV（RIFF/WAVE 标识缺失）";
  // fmt 块字段（16kHz/mono/16bit 固定——sherpa featConfig 同源）
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  if (sampleRate !== 16000) return `采样率须 16000（收到 ${sampleRate}）`;
  if (channels !== 1) return `须单声道（收到 ${channels} 声道）`;
  if (bits !== 16) return `须 16bit PCM（收到 ${bits}bit）`;
  return undefined;
}

/** 推理会话（每 worker 进程一次；每请求 reset VAD + 更新语言 hint）。 */
export function createTranscriber(config: LocalSttWorkerConfig): (audio: Uint8Array, language: string) => string {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as Sherpa;
  const nativeConfig = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: config.modelPath, language: "auto", useInverseTextNormalization: 1 },
      tokens: config.tokensPath,
      numThreads: config.threads,
      provider: "cpu",
      debug: 0,
    },
  };
  const recognizer = new sherpa.OfflineRecognizer(nativeConfig);
  const detector = new sherpa.Vad(
    {
      sileroVad: {
        model: config.vadPath,
        threshold: 0.5,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        maxSpeechDuration: config.segmentSeconds,
        windowSize: 512,
      },
      sampleRate: 16000,
      numThreads: config.threads,
      provider: "cpu",
      debug: 0,
    },
    config.segmentSeconds + 1.5,
  );
  return (audio, language) => {
    const samples = wavPcm16ToSamples(audio);
    nativeConfig.modelConfig.senseVoice.language = language === "" ? "auto" : language;
    recognizer.setConfig(nativeConfig);
    detector.reset();
    const texts: string[] = [];
    const drain = (): void => {
      while (!detector.isEmpty()) {
        // front(false) 拷贝语义（Electron V8 内存 cage 外的 Node 侧同样按
        // 拷贝取——dsh 注释的同款保守）
        const segment = detector.front(false);
        detector.pop();
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: 16000, samples: segment.samples });
        recognizer.decode(stream);
        const text = recognizer.getResult(stream).text.trim();
        if (text !== "") texts.push(text);
      }
    };
    const windowSize = 512;
    for (let offset = 0; offset + windowSize <= samples.length; offset += windowSize) {
      detector.acceptWaveform(samples.subarray(offset, offset + windowSize));
      drain();
    }
    detector.flush();
    drain();
    return texts.join(" ");
  };
}

// —— 进程入口：readiness 行 + 请求循环（本文件直接执行时生效——import 不触发） ——
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config: LocalSttWorkerConfig = {
    modelPath: process.argv[2] ?? "",
    tokensPath: process.argv[3] ?? "",
    vadPath: process.argv[4] ?? "",
    ...DEFAULTS,
  };
  const transcriber = createTranscriber(config);
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      let req: { id?: string; audioBase64?: string; language?: string };
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        const audio = new Uint8Array(Buffer.from(req.audioBase64 ?? "", "base64"));
        const bad = validateWav(audio, config.maxAudioBytes);
        if (bad !== undefined) {
          process.stdout.write(`${JSON.stringify({ id: req.id, ok: false, code: "INVALID_INPUT", message: bad })}\n`);
          continue;
        }
        const text = transcriber(audio, req.language ?? "");
        process.stdout.write(`${JSON.stringify({ id: req.id, ok: true, text })}\n`);
      } catch (e) {
        process.stdout.write(
          `${JSON.stringify({ id: req.id, ok: false, code: "INFERENCE_FAILED", message: e instanceof Error ? e.message : String(e) })}\n`,
        );
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
