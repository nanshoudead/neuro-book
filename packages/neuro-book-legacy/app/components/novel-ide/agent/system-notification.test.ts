import {afterEach, describe, expect, it, vi} from "vitest";
import {
    isWindowInBackground,
    resetSystemNotificationCooldownForTest,
    showSystemNotificationIfBackground,
    type SystemNotificationHost,
} from "nbook/app/utils/system-notification";

afterEach(() => {
    resetSystemNotificationCooldownForTest();
});

function createHost(overrides: {
    visibilityState?: DocumentVisibilityState;
    focused?: boolean;
    permission?: NotificationPermission;
    requestPermission?: () => Promise<NotificationPermission>;
    notifyImpl?: (title: string, options?: NotificationOptions) => void;
}): SystemNotificationHost & {shown: Array<{title: string; options?: NotificationOptions}>} {
    const shown: Array<{title: string; options?: NotificationOptions}> = [];
    const permission = overrides.permission ?? "granted";
    const NotificationCtor = class FakeNotification {
        static permission: NotificationPermission = permission;
        static requestPermission = overrides.requestPermission
            ?? (async () => permission);
        onclick: ((this: Notification, ev: Event) => void) | null = null;
        constructor(title: string, options?: NotificationOptions) {
            shown.push({title, options});
            overrides.notifyImpl?.(title, options);
        }
        close(): void {
            // no-op
        }
    } as unknown as typeof Notification;

    return {
        visibilityState: overrides.visibilityState ?? "hidden",
        hasFocus: () => overrides.focused ?? false,
        NotificationCtor,
        shown,
    };
}

describe("isWindowInBackground", () => {
    it("标签页隐藏时视为不在前台", () => {
        expect(isWindowInBackground({visibilityState: "hidden", hasFocus: () => true})).toBe(true);
    });

    it("可见但失去焦点时视为不在前台", () => {
        expect(isWindowInBackground({visibilityState: "visible", hasFocus: () => false})).toBe(true);
    });

    it("可见且有焦点时视为在前台", () => {
        expect(isWindowInBackground({visibilityState: "visible", hasFocus: () => true})).toBe(false);
    });
});

describe("showSystemNotificationIfBackground", () => {
    it("前台不弹通知", async () => {
        const host = createHost({visibilityState: "visible", focused: true});
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done",
            host,
        })).resolves.toBe("skipped-foreground");
        expect(host.shown).toEqual([]);
    });

    it("后台且已授权时弹出通知", async () => {
        const host = createHost({visibilityState: "hidden", focused: false, permission: "granted"});
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "Agent 任务已完成",
            host,
        })).resolves.toBe("shown");
        expect(host.shown).toEqual([{
            title: "NeuroBook",
            options: expect.objectContaining({
                body: "Agent 任务已完成",
                tag: "neuro-book-agent-idle",
            }),
        }]);
    });

    it("权限为 default 时请求一次，随后弹出", async () => {
        const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
        const host = createHost({
            visibilityState: "hidden",
            focused: false,
            permission: "default",
            requestPermission,
        });
        // FakeNotification.permission 在 request 后仍是 default；用可变 permission 模拟浏览器更新
        let permission: NotificationPermission = "default";
        Object.defineProperty(host.NotificationCtor, "permission", {
            get: () => permission,
        });
        (host.NotificationCtor as typeof Notification).requestPermission = async () => {
            permission = await requestPermission();
            return permission;
        };

        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done",
            host,
        })).resolves.toBe("shown");
        expect(requestPermission).toHaveBeenCalledOnce();
        expect(host.shown).toHaveLength(1);
    });

    it("权限拒绝时不弹", async () => {
        const host = createHost({visibilityState: "hidden", focused: false, permission: "denied"});
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done",
            host,
        })).resolves.toBe("denied");
        expect(host.shown).toEqual([]);
    });

    it("没有 Notification API 时返回 unsupported", async () => {
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done",
            host: {
                visibilityState: "hidden",
                hasFocus: () => false,
                NotificationCtor: undefined,
            },
        })).resolves.toBe("unsupported");
    });

    it("同 tag 短窗内第二次跳过，避免 agent_end 与 live shell 连发", async () => {
        const host = createHost({visibilityState: "hidden", focused: false, permission: "granted"});
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done",
            host,
        })).resolves.toBe("shown");
        await expect(showSystemNotificationIfBackground({
            title: "NeuroBook",
            body: "done again",
            host,
        })).resolves.toBe("skipped-cooldown");
        expect(host.shown).toHaveLength(1);
    });
});
