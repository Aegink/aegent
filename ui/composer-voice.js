/**
 * 语音录制状态机（T-P3-149 批 1·U26 语音域升级）——Composer 录音交互从
 * "单按钮两态无反馈"升为三态机（qwen-code VoiceButton / dsh VoiceInput /
 * pideck VoiceTranscriptionControls 三仓同构）：
 *
 *   idle ──start──▶ recording ──stop──▶ transcribing ──▶ idle
 *                     │  ▲ 上限自动停        │
 *                     └──┴──── cancel ◀──────┘（转写中不可取消，只可失败回退）
 *
 * 录音中：红点 + mm:ss 计时 + 7 根 RMS 电平条（dsh audio.ts:92-98 同款采样）+
 * 时长上限自动停（dsh maxDurationSeconds 语义，默认 120s）；失败后 2s 冷却
 * （qwen use-voice-input:647-651）；Esc 取消（dsh 取消矩阵的最小面）。
 *
 * 插入冲突保护：resolveVoiceInsertion 移植 pideck voiceTranscriptionInsert.ts
 * （选区快照经公共前/后缀映射，编辑与选区重叠即 stale）——异步转写返回时
 * 绝不覆盖用户新输入。
 * mime 探测链：pideck useVoiceTranscription:12,145-146 同款降级序。
 */

/** 时长上限缺省值（dsh maxDurationSeconds 默认 120s 对齐）。 */
export const RECORD_MAX_SECONDS_DEFAULT = 120;

/** 失败冷却窗口（qwen use-voice-input.ts:647-651 对齐）。 */
const FAIL_COOLDOWN_MS = 2000;

/** 电平条根数（qwen 16 格的轻量版——composer 底行空间内）。 */
const METER_BARS = 7;

/**
 * 插入冲突裁决：录音开始时的选区快照 {draft, from, to} 映射到转写返回时的
 * 当前草稿。编辑只发生在选区前/后才安全；重叠即返回 null（stale），调用方
 * 回退为末尾追加（不覆盖、不丢数据）。纯函数——pideck
 * voiceTranscriptionInsert.ts:15-41 的 JS 移植。
 */
export function resolveVoiceInsertion({ snapshotDraft, from, to, currentDraft, text }) {
  if (from < 0 || to < from || to > snapshotDraft.length) return null;
  let f = from;
  let t = to;
  if (currentDraft !== snapshotDraft) {
    const prefix = commonPrefixLength(snapshotDraft, currentDraft);
    const suffix = commonSuffixLength(snapshotDraft, currentDraft, prefix);
    const oldChangedEnd = snapshotDraft.length - suffix;
    const isCaret = from === to;
    const safelyBefore = isCaret ? oldChangedEnd < from : oldChangedEnd <= from;
    const safelyAfter = isCaret ? prefix > to : prefix >= to;
    if (safelyBefore) {
      const delta = currentDraft.length - snapshotDraft.length;
      f += delta;
      t += delta;
    } else if (!safelyAfter) {
      return null;
    }
  }
  return {
    value: currentDraft.slice(0, f) + text + currentDraft.slice(t),
    caret: f + text.length,
  };
}

/** MediaRecorder mime 探测降级链（pideck 同序——跨平台格式兼容标准写法）。 */
export function pickRecorderMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

/**
 * 任意录音 blob → 16kHz 单声道 PCM16 WAV（dsh client/audio.ts:117-128 的
 * 整段重采样方案：decodeAudioData → OfflineAudioContext 渲染 → 手写 44 字节
 * RIFF 头）。chat 协议通道专用——OpenAI input_audio 只收 wav/mp3，浏览器
 * MediaRecorder 产的 webm 须转码后再上送。
 */
export async function resampleToWav16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  const decodeCtx = new Ctx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close().catch(() => {});
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWavPcm16(rendered.getChannelData(0), 16000);
}

/** Float32 采样 → PCM16 WAV Blob（44 字节头——dsh audio.ts:13-27 同款）。 */
function encodeWavPcm16(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left, right, prefix) {
  const limit = Math.min(left.length, right.length) - prefix;
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 录音捕获器。deps：
 *   micBtn     🎤 按钮（recording 态切 ⏹，其余恢复）
 *   statusEl   状态容器 #voice-status（hidden 切换；含 .voice-dot 计时 电平条 取消钮）
 *   timerEl    #voice-timer
 *   meterEl    #voice-meter（内含 METER_BARS 个 <i>）
 *   cancelBtn  #voice-cancel
 *   onStop(blob, mimeType)   录音自然结束（上限/手动停止）——转写由调用方做
 *   onPhase(phase)           idle|recording|transcribing 通知（app.js 切 micBtn 面）
 * start({maxSeconds, silenceStop})：
 *   maxSeconds  时长上限（≤0 = 用缺省）
 *   silenceStop 静音自动停止（qwen SoX VAD 语义——连续 2s 低于 1% 幅度即停；
 *               起始 3s 保护期不计——冷启动竞态不误停）
 * 破坏性取消 = cancel()；转写中置 transcribing；失败调 noteFailure() 进冷却。
 */
export function createVoiceCapture(deps) {
  const { micBtn, statusEl, timerEl, meterEl, cancelBtn, onStop, onPhase } = deps;
  let phase = "idle";
  let recorder = null;
  let stream = null;
  let chunks = [];
  let audioCtx = null;
  let analyser = null;
  let meterSamples = null;
  let levelRaf = 0;
  let timerIv = 0;
  let maxTimer = 0;
  let startedAt = 0;
  let lastFailAt = 0;
  let cancelled = false;
  let silenceEnabled = false;
  let silenceSince = 0;

  // Esc 取消（dsh 取消矩阵最小面——capture 阶段抢在快捷键分发前）
  const escHandler = (ev) => {
    if (ev.key === "Escape" && phase === "recording") {
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    }
  };
  document.addEventListener("keydown", escHandler, true);

  cancelBtn.addEventListener("click", () => {
    if (phase === "recording") cancel();
  });

  function setPhase(next) {
    phase = next;
    statusEl.hidden = next === "idle";
    micBtn.classList.toggle("recording", next === "recording");
    micBtn.textContent = next === "recording" ? "⏹" : "🎤";
    statusEl.dataset.phase = next;
    onPhase(next);
  }

  /** RMS 电平条：requestAnimationFrame 直改 DOM（dsh Waveform.tsx 节流思路）。 */
  function renderLevel() {
    if (analyser === null) return;
    analyser.getFloatTimeDomainData(meterSamples);
    let sum = 0;
    for (const sample of meterSamples) sum += sample * sample;
    const rms = Math.sqrt(sum / meterSamples.length);
    // G3 静音自动停止（qwen SoX silence 2.0s 语义）：起始 3s 保护期后连续
    // 2s 低于 1% 幅度即停——冷启动竞态/误触不误停
    if (silenceEnabled && rms < 0.01 && Date.now() - startedAt >= 3000) {
      if (silenceSince === 0) {
        silenceSince = Date.now();
      } else if (Date.now() - silenceSince >= 2000) {
        silenceSince = 0;
        stop();
        return;
      }
    } else {
      silenceSince = 0;
    }
    const level = Math.min(1, rms * 8); // qwen 增益 ×8 量级——常规说话到 2/3 高度
    const bars = meterEl.children;
    for (let i = 0; i < bars.length; i += 1) {
      // 两侧条低中间条高的静态包络 × 实时电平——视觉上像声音在中间滚动
      const envelope = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / bars.length);
      bars[i].style.height = `${Math.max(12, Math.round(level * envelope * 100))}%`;
    }
    levelRaf = requestAnimationFrame(renderLevel);
  }

  async function start(maxSeconds, silenceStop) {
    if (phase !== "idle") return;
    if (Date.now() - lastFailAt < FAIL_COOLDOWN_MS) {
      throw Object.assign(new Error("转写刚失败——稍候 2 秒再试"), { code: "VOICE_COOLDOWN" });
    }
    silenceEnabled = silenceStop === true;
    silenceSince = 0;
    const limit = maxSeconds > 0 ? maxSeconds : RECORD_MAX_SECONDS_DEFAULT;
    if (navigator.mediaDevices === undefined) {
      throw Object.assign(new Error("当前环境不支持录音（需 HTTPS 或桌面壳）"), { code: "VOICE_UNAVAILABLE" });
    }
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, // dsh audio.ts:63 同约束
      });
    } catch (e) {
      const code = e.name === "NotAllowedError" ? "VOICE_PERMISSION" : "VOICE_UNAVAILABLE";
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { code });
    }
    stream = media;
    chunks = [];
    cancelled = false;
    const mimeType = pickRecorderMime();
    recorder = new MediaRecorder(stream, mimeType === "" ? undefined : { mimeType });
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    });
    recorder.addEventListener("stop", () => {
      releaseStream();
      if (cancelled) return; // 取消 = 丢弃，不进转写
      const type = (recorder?.mimeType ?? mimeType ?? "audio/webm").split(";")[0];
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) {
        setPhase("idle"); // 空录音静默（qwen :517-520）
        return;
      }
      // phase 停在 transcribing——调用方转写完成后 finish()/noteFailure() 回 idle
      onStop(blob, type);
    });
    recorder.start();

    // 电平面：AnalyserNode RMS（dsh audio.ts:92-98）
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      meterSamples = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      levelRaf = requestAnimationFrame(renderLevel);
    } catch {
      analyser = null; // 电平面失败不阻断录音
    }

    startedAt = Date.now();
    timerIv = window.setInterval(() => {
      timerEl.textContent = formatClock(Date.now() - startedAt);
    }, 250);
    timerEl.textContent = "00:00";
    // 时长上限自动停（dsh VoiceInput.tsx:134 maxDuration 语义）
    maxTimer = window.setTimeout(() => {
      if (phase === "recording") stop();
    }, limit * 1000);
    setPhase("recording");
  }

  /** 手动停止 / 上限自动停——进转写。 */
  function stop() {
    if (phase !== "recording" || recorder === null) return;
    window.clearInterval(timerIv);
    window.clearTimeout(maxTimer);
    stopLevel();
    setPhase("transcribing"); // 先置态（recorder stop 事件异步抵达）
    recorder.stop();
  }

  /** 破坏性取消——丢弃录音直接回 idle。 */
  function cancel() {
    if (phase !== "recording" || recorder === null) return;
    cancelled = true;
    window.clearInterval(timerIv);
    window.clearTimeout(maxTimer);
    stopLevel();
    recorder.stop(); // stop 回调里 cancelled 分支丢弃
    setPhase("idle");
  }

  /** 转写完毕回 idle；失败调 noteFailure 后回 idle（进冷却）。 */
  function finish() {
    if (phase === "transcribing") setPhase("idle");
  }

  function noteFailure() {
    lastFailAt = Date.now();
    finish();
  }

  function stopLevel() {
    if (levelRaf !== 0) {
      cancelAnimationFrame(levelRaf);
      levelRaf = 0;
    }
    if (audioCtx !== null) {
      void audioCtx.close().catch(() => {}); // 关闭失败不吞录音结果（dsh 纪律）
      audioCtx = null;
      analyser = null;
    }
  }

  function releaseStream() {
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  return {
    start,
    stop,
    cancel,
    finish,
    noteFailure,
    get phase() {
      return phase;
    },
  };
}
