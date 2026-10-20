/**
 * 工作台通知服务（docs/specs/workbench/notifications.md 输出 2 到 5）：发出的通知在视口里出现；error 与带动作的常驻，
 * 其余按色调自动消失；update 推进进度并在任务结束后改成限时；明确给的 sticky 保留；动作点了通知移除，抛错也移除并记诊断；dispose 清空。
 * 真实的 nb-ui 队列与视口，时长用真实的短时长等可观察结果。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {h} from "vue";

import {NotificationStack} from "@notnotype/nb-ui/components";

import {createNotifications} from "./notifications";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function world() {
    const reports: string[] = [];
    const notifications = createNotifications((message) => reports.push(message));
    const wrapper = mount({render: () => h(NotificationStack, {queue: notifications.queue, position: "bottom-right"})}, {attachTo: document.body});
    mounted.push(wrapper);
    const texts = (): string[] => [...document.body.querySelectorAll("[data-notification-stack] [role='status']")].map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "");
    return {notifications, texts, reports};
}

describe("工作台通知服务", () => {
    it("通知出现在视口里；error 与带动作的常驻，info 自动消失", async () => {
        const {notifications, texts} = world();
        const failed = notifications.notify({tone: "error", title: "保存失败", message: "磁盘已满"});
        const retry = notifications.notify({tone: "warning", title: "书架没有更新", message: "连接已断开", action: {label: "重试", run: () => {}}});
        notifications.notify({tone: "info", message: "已切换主题"});
        await flushPromises();
        expect(texts()).toHaveLength(3);
        expect(notifications.queue.notifications.value.map((item) => item.duration)).toEqual([0, 0, 3200]);
        failed.dismiss();
        retry.dismiss();
        await flushPromises();
        expect(texts()).toHaveLength(1);
        expect(texts()[0]).toContain("已切换主题");
        notifications.dispose();
    });

    it("动作点了之后执行并移除通知", async () => {
        const {notifications, texts} = world();
        const runs: string[] = [];
        notifications.notify({tone: "warning", title: "书架没有更新", message: "连接已断开", action: {label: "重试", run: () => runs.push("retry")}});
        await flushPromises();
        const button = [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "重试");
        expect(button).toBeDefined();
        button?.click();
        await flushPromises();
        expect(runs).toEqual(["retry"]);
        expect(texts()).toHaveLength(0);
        notifications.dispose();
    });

    it("动作抛错时通知仍移除，错误记一条诊断", async () => {
        const {notifications, texts, reports} = world();
        notifications.notify({tone: "warning", message: "连接已断开", action: {label: "重试", run: () => {
            throw new Error("重连失败");
        }}});
        await flushPromises();
        [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "重试")?.click();
        await flushPromises();
        expect(texts()).toHaveLength(0);
        expect(reports).toEqual(["通知动作“重试”失败：重连失败"]);
        notifications.dispose();
    });

    it("update 推进进度；改成 success 后按时长消失；dispose 清空", async () => {
        const {notifications, texts} = world();
        const handle = notifications.notify({tone: "info", title: "正在统计", message: "0 部", progress: 0, sticky: true});
        await flushPromises();
        // 明确给的 sticky 不因别的字段更新而丢：只改色调仍常驻。
        handle.update({tone: "warning"});
        expect(notifications.queue.notifications.value[0]?.duration).toBe(0);
        expect(document.body.querySelector("[data-notification-progress]")).not.toBeNull();
        handle.update({message: "3 部", progress: 50});
        await flushPromises();
        expect(texts()[0]).toContain("3 部");
        expect(notifications.queue.notifications.value[0]?.progress).toBe(50);
        // sticky 改回 false 后按 success 的时长消失；这里把时长压短不靠假计时器：先确认它不再常驻。
        handle.update({tone: "success", title: "统计完成", progress: 100, sticky: false});
        expect(notifications.queue.notifications.value[0]?.duration).toBe(3200);
        notifications.notify({tone: "info", message: "另一条"});
        notifications.dispose();
        await flushPromises();
        expect(texts()).toHaveLength(0);
    });

    it("限时通知到点消失", async () => {
        const {notifications, texts} = world();
        notifications.queue.notify({message: "一闪而过", duration: 30});
        await flushPromises();
        expect(texts()).toHaveLength(1);
        await vi.waitFor(() => {
            expect(texts()).toHaveLength(0);
        });
        notifications.dispose();
    });
});
