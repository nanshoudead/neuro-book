type DesktopNotificationInput = {
    title: string;
    body: string;
};

type TauriNotificationApi = {
    isPermissionGranted: () => Promise<boolean>;
    requestPermission: () => Promise<"granted" | "denied" | "default">;
    sendNotification: (options: DesktopNotificationInput) => void;
};

type TauriCoreApi = {
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

let permissionReady: boolean | null = null;
let warningLogged = false;

function logNotificationFailure(error: unknown): void {
    if (warningLogged) {
        return;
    }
    warningLogged = true;
    console.warn("Windows 系统通知发送失败", error);
}

async function notifyByTauriCommand(input: DesktopNotificationInput): Promise<boolean> {
    const core = await import("@tauri-apps/api/core") as TauriCoreApi;
    if (permissionReady !== true) {
        const granted = await core.invoke<boolean | null>("plugin:notification|is_permission_granted");
        if (granted === false) {
            permissionReady = false;
            return false;
        }
        if (granted !== true) {
            const permission = await core.invoke<string>("plugin:notification|request_permission");
            permissionReady = permission === "granted";
        } else {
            permissionReady = true;
        }
    }
    if (!permissionReady) {
        return false;
    }
    await core.invoke("plugin:notification|notify", {
        options: {
            title: input.title,
            body: input.body,
            autoCancel: true,
        },
    });
    return true;
}

async function notifyByWebNotification(input: DesktopNotificationInput): Promise<boolean> {
    const api = await import("@tauri-apps/plugin-notification") as TauriNotificationApi;
    if (permissionReady !== true) {
        permissionReady = await api.isPermissionGranted();
        if (!permissionReady) {
            permissionReady = await api.requestPermission() === "granted";
        }
    }
    if (!permissionReady) {
        return false;
    }

    api.sendNotification(input);
    return true;
}

/**
 * 发送系统级桌面通知。非 Tauri 环境静默跳过，避免影响浏览器开发模式。
 */
export function useDesktopNotification() {
    const notify = async (input: DesktopNotificationInput): Promise<boolean> => {
        if (!import.meta.client) {
            return false;
        }

        try {
            return await notifyByTauriCommand(input);
        } catch (nativeError) {
            try {
                return await notifyByWebNotification(input);
            } catch (webError) {
                logNotificationFailure({nativeError, webError});
                return false;
            }
        }
    };

    return {notify};
}
