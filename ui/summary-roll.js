/**
 * 摘要滚动队列（T-P3-174 批次 2 —— zcode QueuedSummaryContent + 
 * FlipMetricValue 的零构建纯 JS 复刻；CSS transform + setTimeout 链，
 * 无动画库、无依赖——叶子模块）。
 *
 * 状态机（zcode 同构，常量原文对齐）：
 *   - 3 格队列：当前显示 1 格 + 待播 2 格（queued；第 2 格锁死不被覆盖，
 *     新摘要只能替换第 3 格"可插队"条）；
 *   - 300ms 纵向滚动过渡（cubic-bezier(0.4,0,0.2,1)，y ±0.8em 淡入淡出）
 *     + 500ms 停留 = 800ms/条（setTimeout 自链）；
 *   - timer 漂移跳帧：主线程繁忙时 setTimeout 晚到，晚到量 > 250ms 且
 *     积压 > 1 条 → 丢弃中间态只播最新（过期状态排队播放比卡顿更糟）；
 *   - 同 key 原位刷新：显示中条目的 key 与新条目相同（且只有 trailing/
 *     refreshVersion 变化）→ 原地改文本不重播滚动（同一命令的持续输出、
 *     同一文件的连续 diff 不能反复滚动）。
 *
 * trailing 数字翻页（FlipMetricValue 同构）：逐槽两层 rotateX ±90°
 * 0.16s（perspective 8em 裁切窗）；进位无联动——逐槽独立翻、新增槽静态
 * 出现；非数字字符静态渲染；prefers-reduced-motion 全部直切。
 */

export const SUMMARY_ROLL_TRANSITION_MS = 300;
export const SUMMARY_ROLL_HOLD_MS = 500;
export const SUMMARY_ROLL_TOTAL_MS = SUMMARY_ROLL_TRANSITION_MS + SUMMARY_ROLL_HOLD_MS;
export const SUMMARY_ROLL_TIMER_DRIFT_SKIP_MS = 250;
export const SUMMARY_ROLL_MAX_PENDING = 2;
const FLIP_MS = 160;

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 漂移跳帧（zcode resolveQueuedSummaryPlaybackQueue 同构）。 */
function resolvePlaybackQueue(queue, timerDriftMs) {
  if (timerDriftMs > SUMMARY_ROLL_TIMER_DRIFT_SKIP_MS && queue.length > 1) {
    return [queue[queue.length - 1]];
  }
  return [...queue];
}

/** 同 key 原位刷新判定（zcode shouldRefreshQueuedSummaryContent 同构）。 */
function shouldRefreshInPlace(current, next) {
  return (
    current !== null &&
    current.key === next.key &&
    (current.trailingText !== next.trailingText || current.refreshVersion !== next.refreshVersion)
  );
}

/**
 * 数字翻页：把 value 写进 container，数字字符逐槽两层 rotateX 翻页；
 * 位数增减 = 新槽静态出现（无进位链——zcode FlipMetricValue 同款）。
 * container 复用：连续调用只更新变化的槽。
 */
export function flipMetricInto(container, value) {
  const text = String(value ?? "");
  const reduced = prefersReducedMotion();
  // 槽位数对齐（旧多新少 → 截掉旧槽；旧少新多 → 追加）
  while (container.children.length > text.length) container.lastElementChild?.remove();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let slot = container.children[i];
    if (slot === undefined) {
      slot = document.createElement("span");
      slot.className = "flip-slot";
      const inner = document.createElement("span");
      inner.className = "flip-char";
      inner.textContent = ch;
      slot.appendChild(inner);
      container.appendChild(slot);
      continue; // 新槽静态出现
    }
    const inner = slot.firstElementChild;
    const prev = inner?.textContent ?? "";
    if (prev === ch) continue;
    if (reduced || !/[0-9]/.test(ch) || !/[0-9]/.test(prev)) {
      inner.textContent = ch; // 非数字或 reduced：直切
      continue;
    }
    // 旧字面翻出（rotateX 0→90），新字面翻入（-90→0）——两层同帧并存
    const out = document.createElement("span");
    out.className = "flip-char flip-out";
    out.textContent = prev;
    slot.appendChild(out);
    const newIn = document.createElement("span");
    newIn.className = "flip-char flip-in";
    newIn.textContent = ch;
    slot.appendChild(newIn);
    inner.remove();
    const anim = newIn.animate(
      [
        { transform: "rotateX(-90deg) translateY(-0.45em)", opacity: "0" },
        { transform: "rotateX(0deg) translateY(0)", opacity: "1" },
      ],
      { duration: FLIP_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    out.animate(
      [
        { transform: "rotateX(0deg) translateY(0)", opacity: "1" },
        { transform: "rotateX(90deg) translateY(0.45em)", opacity: "0" },
      ],
      { duration: FLIP_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    anim.addEventListener("finish", () => {
      out.remove();
      newIn.classList.remove("flip-in");
    });
  }
}

/**
 * 创建滚动队列实例。el 结构：
 *   <span class="summary-roll">
 *     <span class="summary-roll-window"><span class="summary-roll-item">…</span></span>
 *     <span class="summary-roll-trailing"></span>
 *   </span>
 * trailing 在滚动层外——与 zcode 同语义：trailing 数字与摘要属同一快照，
 * 但数字独立翻页，不跟整条摘要纵向滚走。
 */
export function createSummaryRoll() {
  const el = document.createElement("span");
  el.className = "summary-roll";
  const windowEl = document.createElement("span");
  windowEl.className = "summary-roll-window";
  const trailing = document.createElement("span");
  trailing.className = "summary-roll-trailing";
  el.append(windowEl, trailing);

  let displayed = null; // { key, refreshVersion?, primaryText, secondaryText?, trailingText? }
  let pending = []; // 待播格（≤2）
  let animating = false;
  let timer = 0;
  let expectedAt = 0;

  const clearTimer = () => {
    if (timer !== 0) {
      clearTimeout(timer);
      timer = 0;
    }
  };

  const paintItem = (itemEl, snapshot) => {
    itemEl.replaceChildren();
    itemEl.appendChild(document.createTextNode(snapshot.primaryText ?? ""));
    if (snapshot.secondaryText) {
      const sec = document.createElement("span");
      sec.className = "summary-roll-secondary";
      sec.textContent = ` · ${snapshot.secondaryText}`;
      itemEl.appendChild(sec);
    }
  };

  const paintTrailing = (snapshot) => {
    trailing.replaceChildren();
    if (snapshot?.trailingText !== undefined && snapshot.trailingText !== "") {
      flipMetricInto(trailing, snapshot.trailingText);
    }
  };

  /** 展示一格：旧条上滚淡出，新条下滚淡入（300ms），随后 500ms 停留。 */
  const promote = (snapshot) => {
    displayed = snapshot;
    animating = true;
    paintTrailing(snapshot);
    const prev = windowEl.firstElementChild;
    const next = document.createElement("span");
    next.className = "summary-roll-item";
    paintItem(next, snapshot);
    windowEl.appendChild(next);
    const reduced = prefersReducedMotion();
    if (prev === null || reduced) {
      prev?.remove();
      if (reduced) {
        animating = false;
        timer = window.setTimeout(step, SUMMARY_ROLL_HOLD_MS);
        expectedAt = Date.now() + SUMMARY_ROLL_HOLD_MS;
        return;
      }
    } else {
      prev.classList.add("roll-out");
      next.classList.add("roll-in");
      // 旧条脱流（绝对定位覆盖在窗口顶）——窗口宽度即刻跟随新条（popLayout 语义）
      requestAnimationFrame(() => {
        prev.style.position = "absolute";
        prev.style.left = "0";
        prev.style.top = "0";
        prev.style.width = "100%";
        window.setTimeout(() => prev.remove(), SUMMARY_ROLL_TRANSITION_MS);
      });
    }
    timer = window.setTimeout(step, SUMMARY_ROLL_TOTAL_MS);
    expectedAt = Date.now() + SUMMARY_ROLL_TOTAL_MS;
  };

  const step = () => {
    animating = false;
    timer = 0;
    const timerDrift = Date.now() - expectedAt;
    pending = resolvePlaybackQueue(pending, timerDrift);
    const [next, ...rest] = pending;
    if (next === undefined) {
      pending = [];
      return;
    }
    pending = rest;
    promote(next);
  };

  const enqueue = (snapshot) => {
    const idx = pending.findIndex((item) => item.key === snapshot.key);
    if (idx >= 0) {
      pending[idx] = snapshot; // 队内同 key 原位覆盖（不因去重留下过期态）
      return;
    }
    if (pending.length === 0) {
      pending = [snapshot];
      return;
    }
    // 三格上限：待播第 1 格（下一条）锁死，新摘要替换第 2 格（可插队条）
    pending = [pending[0], snapshot].slice(0, SUMMARY_ROLL_MAX_PENDING);
  };

  return {
    el,
    /** 喂入一条步骤事实快照。 */
    push(snapshot) {
      if (snapshot === null || snapshot === undefined) return;
      if (shouldRefreshInPlace(displayed, snapshot)) {
        // 同 key 原位刷新：文本与 trailing 原地改，不重播滚动
        const item = windowEl.querySelector(".summary-roll-item:not(.roll-out)");
        if (item !== null) paintItem(item, snapshot);
        paintTrailing(snapshot);
        displayed = snapshot;
        return;
      }
      if (animating || pending.length > 0) {
        enqueue(snapshot);
        return;
      }
      if (displayed === null) {
        promote(snapshot);
        return;
      }
      // 空闲且已停稳：停留期已过（非 animating）→ 新条目照常走滚动
      enqueue(snapshot);
      if (!animating && timer === 0) step();
    },
    /** 停止并清空（工作行卸载/恢复视图重建时）。 */
    clear() {
      clearTimer();
      pending = [];
      displayed = null;
      animating = false;
      windowEl.replaceChildren();
      trailing.replaceChildren();
    },
  };
}
