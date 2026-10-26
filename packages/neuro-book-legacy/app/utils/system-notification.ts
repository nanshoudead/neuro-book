/**
 * 浏览器系统通知（Windows 通知中心等）。
 * 仅在页面不在前台时发出；权限未定时会请求一次，拒绝则静默跳过。
 */

export type SystemNotificationHost = {
    visibilityState: DocumentVisibilityState;
    hasFocus: () => boolean;
    NotificationCtor?: typeof Notification | undefined;
};

export type SystemNotificationResult =
    | "shown"
    | "skipped-foreground"
    | "skipped-cooldown"
    | "unsupported"
    | "denied";

const AGENT_IDLE_TAG = "neuro-book-agent-idle";
/** agent_end 与 live shell 兜底可能连发；同 tag 短窗内只弹一次。 */
const NOTIFY_COOLDOWN_MS = 2_000;
const lastShownAtByTag = new Map<string, number>();

/** 切走标签页、最小化，或窗口失去焦点时视为不在前台。 */
export function isWindowInBackground(host: Pick<SystemNotificationHost, "visibilityState" | "hasFocus">): boolean {
    return host.visibilityState === "hidden" || !host.hasFocus();
}

/** 测试用：清空防连发计时。 */
export function resetSystemNotificationCooldownForTest(): void {
    lastShownAtByTag.clear();
}

/**
 * 在用户仍与页面交互时请求通知权限（例如 Agent 开跑）。
 * 后台完成时再 requestPermission 往往没有手势，浏览器会卡住或直接拒绝。
 */
export function ensureSystemNotificationPermission(hostOverride?: SystemNotificationHost): void {
    const host = resolveHost(hostOverride);
    if (!host?.NotificationCtor) {
        return;
    }
    if (isWindowInBackground(host)) {
        return;
    }
    if (host.NotificationCtor.permission !== "default") {
        return;
    }
    void host.NotificationCtor.requestPermission().catch(() => undefined);
}

function resolveHost(override?: SystemNotificationHost): SystemNotificationHost | null {
    if (override) {
        return override;
    }
    if (typeof document === "undefined") {
        return null;
    }
    return {
        visibilityState: document.visibilityState,
        hasFocus: () => document.hasFocus(),
        NotificationCtor: typeof Notification === "undefined" ? undefined : Notification,
    };
}

/**
 * 窗口不在前台时弹出系统通知；前台、无 API、或权限拒绝时不弹。
 * 同 tag 会替换上一条，避免连发堆叠。
 */
export async function showSystemNotificationIfBackground(input: {
    title: string;
    body: string;
    tag?: string;
    host?: SystemNotificationHost;
}): Promise<SystemNotificationResult> {
    const host = resolveHost(input.host);
    if (!host?.NotificationCtor) {
        return "unsupported";
    }
    if (!isWindowInBackground(host)) {
        return "skipped-foreground";
    }

    const tag = input.tag ?? AGENT_IDLE_TAG;
    const now = Date.now();
    const lastShownAt = lastShownAtByTag.get(tag) ?? 0;
    if (now - lastShownAt < NOTIFY_COOLDOWN_MS) {
        return "skipped-cooldown";
    }

    let permission = host.NotificationCtor.permission;
    if (permission === "default") {
        try {
            permission = await host.NotificationCtor.requestPermission();
        } catch {
            return "denied";
        }
    }
    if (permission !== "granted") {
        return "denied";
    }

    try {
        const notification = new host.NotificationCtor(input.title, {
            body: input.body,
            tag,
        });
        notification.onclick = () => {
            try {
                globalThis.focus?.();
            } catch {
                // 忽略：部分环境不允许脚本抢焦点
            }
            notification.close();
        };
        lastShownAtByTag.set(tag, now);
        return "shown";
    } catch {
        return "unsupported";
    }
}

/** Agent 回合结束回到空闲时的系统通知文案入口。 */
export function notifyAgentRunIdleIfBackground(input: {
    title: string;
    body: string;
    host?: SystemNotificationHost;
}): void {
    void showSystemNotificationIfBackground({
        title: input.title,
        body: input.body,
        tag: AGENT_IDLE_TAG,
        host: input.host,
    });
}
