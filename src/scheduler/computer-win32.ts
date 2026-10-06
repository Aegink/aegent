/**
 * 计算机使用的 Win32 执行体（S4 人工确认清单"Win32 实现补齐"清偿）——
 * 经 PowerShell 直发（零 Rust 改动、node 侧 spawn 即进程边界）：
 *   - screenshot：System.Drawing CopyFromScreen 全虚屏 → PNG base64；
 *   - click：user32 SetCursorPos + mouse_event（左/右/中键）；
 *   - type / key：System.Windows.Forms.SendKeys::SendWait（type 经
 *     escapeSendKeys 转义特殊字符；key 经 parseKeySequence 解析键序）。
 *
 * 已知边界（记档）：主屏/DPI 缩放场景坐标按物理像素（未做 Per-Monitor
 * DPI 感知——Windows 缩放 ≠100% 时截图尺寸为物理像素，坐标语义由模型
 * 以截图为准自洽）；type 的大段 Unicode 文本 SendKeys 有逐键注入延迟，
 * 长文本走剪贴板路径列后续。每次操作 spawn 一个 powershell（数百 ms——
 * 低频操作可接受；windowsHide 不闪窗）。
 */

import { spawn } from "node:child_process";
import type { ComputerUseRequest, ComputerUseResponse } from "./computer.js";

const SEND_KEYS_SPECIALS = new Set(["+", "^", "%", "~", "(", ")", "{", "}", "[", "]"]);

/** type 文本 → SendKeys 转义（特殊字符包 {}；字面 {} 转义 {{}{}}）。 */
function escapeSendKeys(text: string): string {
  let out = "";
  for (const ch of text) {
    out += SEND_KEYS_SPECIALS.has(ch) ? `{${ch}}` : ch;
  }
  return out;
}

const KEY_TOKENS: Record<string, string> = {
  enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}",
  space: " ", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  delete: "{DEL}", del: "{DEL}", backspace: "{BS}", home: "{HOME}", end: "{END}",
  pageup: "{PGUP}", pagedown: "{PGDN}", insert: "{INS}", win: "#",
};
const MODIFIER_TOKENS: Record<string, string> = { ctrl: "^", alt: "%", shift: "+" };

/** 键序 "ctrl+shift+s" → SendKeys "^+s"；具名键映射、其余键**保留原大小写**
 * （F4 小写成 f4 会被 SendKeys 拆成 f+4 两键——F 键必须保形）；未知键字面透传。 */
export function parseKeySequence(sequence: string): string {
  const parts = sequence.trim().split("+").filter((p) => p !== "");
  let modifiers = "";
  const keys: string[] = [];
  for (const raw of parts) {
    const part = raw.toLowerCase();
    const modifier = MODIFIER_TOKENS[part];
    if (modifier !== undefined) {
      modifiers += modifier;
      continue;
    }
    keys.push(KEY_TOKENS[part] ?? raw);
  }
  return modifiers + keys.join("");
}

const PS_ADD_TYPE_MOUSE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AegentMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
`;

const MOUSE_BUTTON_FLAGS: Record<string, [number, number]> = {
  left: [2, 4], // LEFTDOWN / LEFTUP
  right: [8, 16],
  middle: [32, 64],
};

/** 组装单操作的 PowerShell 脚本（一操作一进程——无状态面）。 */
export function buildComputerScript(request: ComputerUseRequest): string {
  switch (request.operation) {
    case "screenshot":
      return [
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
        "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
        "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
        "$g = [System.Drawing.Graphics]::FromImage($bmp)",
        "$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)",
        "$ms = New-Object System.IO.MemoryStream",
        "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
        "[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))",
      ].join("\n");
    case "click": {
      const x = Math.trunc(request.x ?? 0);
      const y = Math.trunc(request.y ?? 0);
      const [down, up] = MOUSE_BUTTON_FLAGS[request.button ?? "left"] ?? MOUSE_BUTTON_FLAGS.left!;
      return [
        PS_ADD_TYPE_MOUSE,
        `$r = [AegentMouse]::SetCursorPos(${x}, ${y})`,
        "if (-not $r) { [Console]::Out.Write('ERR:SETCURSOR_FAILED'); exit }",
        `[AegentMouse]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)`,
        "Start-Sleep -Milliseconds 30",
        `[AegentMouse]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)`,
        "[Console]::Out.Write('OK:click')",
      ].join("\n");
    }
    case "type": {
      const text = escapeSendKeys(request.text ?? "");
      return [
        "Add-Type -AssemblyName System.Windows.Forms",
        `[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`,
        "[Console]::Out.Write('OK:type')",
      ].join("\n");
    }
    case "key": {
      const sequence = parseKeySequence(request.key ?? "");
      return [
        "Add-Type -AssemblyName System.Windows.Forms",
        `[System.Windows.Forms.SendKeys]::SendWait('${sequence.replace(/'/g, "''")}')`,
        "[Console]::Out.Write('OK:key')",
      ].join("\n");
    }
  }
}

export interface ComputerWin32Options {
  /** 单操作预算（缺省 20s——截图含首次程序集加载可到数秒）。 */
  timeoutMs?: number;
  /** PowerShell 可执行（缺省 powershell.exe——Windows PowerShell 5.1 恒在）。 */
  shell?: string;
}

/** 生产 run 面：spawn PowerShell 执行单操作（结构化 ok/error 响应）。 */
export function createWin32ComputerRun(
  options: ComputerWin32Options = {},
): (request: ComputerUseRequest) => Promise<ComputerUseResponse> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  return (request) =>
    new Promise<ComputerUseResponse>((resolve) => {
      let settled = false;
      const finish = (response: ComputerUseResponse): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* 已退出 */
        }
        finish({ ok: false, error: { code: "COMPUTER_TIMEOUT", message: `PowerShell 操作超时（${String(timeoutMs)}ms）` } });
      }, timeoutMs);
      const child = spawn(options.shell ?? "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildComputerScript(request)], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-2048)));
      child.on("error", (e) => finish({ ok: false, error: { code: "COMPUTER_SPAWN_FAILED", message: e.message } }));
      child.on("close", () => {
        const out = stdout.trim();
        if (out.startsWith("ERR:")) {
          finish({ ok: false, error: { code: "COMPUTER_OP_FAILED", message: out.slice(4) } });
          return;
        }
        if (out.startsWith("OK:")) {
          finish({ ok: true });
          return;
        }
        if (request.operation === "screenshot" && out !== "") {
          finish({ ok: true, data: out });
          return;
        }
        finish({
          ok: false,
          error: {
            code: "COMPUTER_OP_FAILED",
            message: stderr.trim() !== "" ? stderr.trim().split("\n").slice(-3).join("\n") : "PowerShell 无输出（脚本异常）",
          },
        });
      });
    });
}
