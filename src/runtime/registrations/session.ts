/**
 * 宿主会话原语（T5-2 / EP-1 / EP-2，pi-desktop ADR 0237/0239 形状）：
 * 会话创建 / 打开 / 投递——编排插件与模型工具的全部会话操作经本注册面，
 * **权限档不可由调用者提交**（宿主持锁解析继承源——ADR 0237 的核心边界）。
 */

/** 会话级权限档（session-config 五档映射的原值——继承链的搬运对象）。 */
export type PermissionMode = "ask" | "accept-edits" | "read-only" | "auto" | "unattended";

/** 会话库的结构化子集（SqliteEventStorage 的元数据面——不暴露整库）。 */
export interface SessionLibraryPort {
  createSession(sessionId: string, ts?: number): void;
  getSessionProject(sessionId: string): string | undefined;
  setSessionProject(sessionId: string, projectId: string, options?: { overwrite?: boolean }): void;
  setSessionOrigin(sessionId: string, parentSessionId: string): void;
  setTitle(sessionId: string, title: string, source: "generated" | "custom"): void;
  readSessionIndex(sessionId: string): unknown;
}

export interface SessionPrimitivesDeps {
  readonly library: SessionLibraryPort;
  /** EP-1 权限继承源（宿主持锁读父会话档——调用者侧无任何权限输入面）。 */
  permissionModeOf(sessionId: string): Promise<PermissionMode | undefined>;
  /**
   * 继承档固化（新会话写入宿主的会话档注册表——child 懒派生/首轮装配消费；
   * 宿主装配注入。缺省 no-op = 继承解析只记账不落盘，记档）。
   */
  inheritPermission?(sessionId: string, mode: PermissionMode): void;
  /** 会话工作目录解析（EP-3 cwd 授权边界的数据源；缺省 undefined）。 */
  cwdOf?(sessionId: string): string | undefined;
}

export interface SessionCreateRequest {
  /** 项目归属（缺省 = 继承 parent 的项目）。 */
  projectId?: string;
  /** 血统父会话（session_origins——任务栏"子会话"标志数据源）。 */
  parentSessionId?: string;
  /**
   * EP-1 权限继承源：宿主持锁读该会话的当前 permission mode 固化到新会话
   * ——**调用者不能传 mode**（唯一合法的权限输入是"继承自谁"）。
   */
  inheritPermissionFromSessionId?: string;
  /** 人读标题（缺省 generated 空标题）。 */
  title?: string;
}

export interface SessionCreateResult {
  sessionId: string;
  /** 继承解析结果（父档缺失/未配 = undefined——新会话走全局缺省档）。 */
  inheritedMode?: PermissionMode;
}

export interface DeliverReceipt {
  accepted: boolean;
  reason?: string;
}

export interface SessionRegistration {
  /** EP-1 会话创建（宿主持锁：库行 + 项目/血统/标题 + 权限继承解析）。 */
  sessionCreate(request: SessionCreateRequest): Promise<SessionCreateResult>;
  /** EP-1 会话打开（唯一导航动作——打开后才是投递合法目标）。 */
  sessionOpen(sessionId: string): Promise<boolean>;
  /** 已打开会话清单（观测面）。 */
  openSessions(): readonly string[];
  /**
   * EP-2 会话投递（带授权边界）：目标必须已 sessionOpen——未打开的
   * sessionId 拒绝（防未导航会话被任意写入；ADR 0239 授权边界）。
   */
  sessionDeliver(
    sessionId: string,
    prompt: { messageId: string; content: string },
  ): Promise<DeliverReceipt>;
}

export function registerSessionPrimitives(deps: SessionPrimitivesDeps): SessionRegistration {
  const open = new Set<string>();

  return {
    async sessionCreate(request: SessionCreateRequest): Promise<SessionCreateResult> {
      const sessionId = globalThis.crypto.randomUUID();
      deps.library.createSession(sessionId);
      const project =
        request.projectId ??
        (request.parentSessionId !== undefined
          ? deps.library.getSessionProject(request.parentSessionId)
          : undefined);
      if (project !== undefined) deps.library.setSessionProject(sessionId, project);
      if (request.parentSessionId !== undefined) {
        deps.library.setSessionOrigin(sessionId, request.parentSessionId);
      }
      deps.library.setTitle(sessionId, request.title ?? "", "generated");
      // EP-1 权限继承：解析在宿主侧（调用者无输入面）；父档缺失 = 走全局缺省
      let inheritedMode: PermissionMode | undefined;
      if (request.inheritPermissionFromSessionId !== undefined) {
        inheritedMode = await deps.permissionModeOf(request.inheritPermissionFromSessionId);
        if (inheritedMode !== undefined) {
          deps.inheritPermission?.(sessionId, inheritedMode);
        }
      }
      return { sessionId, ...(inheritedMode !== undefined ? { inheritedMode } : {}) };
    },

    async sessionOpen(sessionId: string): Promise<boolean> {
      const exists =
        deps.library.readSessionIndex(sessionId) !== null &&
        deps.library.readSessionIndex(sessionId) !== undefined;
      if (!exists) return false;
      open.add(sessionId);
      return true;
    },

    openSessions(): readonly string[] {
      return [...open];
    },

    async sessionDeliver(
      sessionId: string,
      prompt: { messageId: string; content: string },
    ): Promise<DeliverReceipt> {
      // EP-2 授权边界：未打开 = 未导航 = 不可投递（fail-closed）
      if (!open.has(sessionId)) {
        return { accepted: false, reason: `会话 ${sessionId} 未打开（EP-2 授权边界——先 sessionOpen 再投递）` };
      }
      if (deps.library.readSessionIndex(sessionId) === null) {
        return { accepted: false, reason: `会话 ${sessionId} 不存在` };
      }
      return { accepted: true };
    },
  };
}
