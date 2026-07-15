type DesktopNotificationInput = {
    title: string;
    body: string;
};

type TauriNotificationApi = {
    isPermissionGranted: () => Promise<boolean>;
    requestPermission: () => Promise<"granted" | "denied" | "default">;
    sendNotification: (options: DesktopNotificationInput) => void;
};

let permissionReady: boolean | null = null;

/**
 * 发送系统级桌面通知。非 Tauri 环境静默跳过，避免影响浏览器开发模式。
 */
export function useDesktopNotification() {
    const notify = async (input: DesktopNotificationInput): Promise<boolean> => {
        if (!import.meta.client) {
            return false;
        }

        try {
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
        } catch {
            return false;
        }
    };

    return {notify};
}
