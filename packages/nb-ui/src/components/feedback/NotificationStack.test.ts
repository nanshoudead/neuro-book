/** NotificationStack（同名 .md）：点动作执行并移除通知；动作抛错时同样移除，错误交给 Vue 的错误处理。 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createNotificationQueue} from "../../composables/useNotification";
import NotificationStack from "./NotificationStack.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const button = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);

describe("NotificationStack", () => {
    it("动作抛错时通知仍移除，错误交给 Vue 的错误处理", async () => {
        const queue = createNotificationQueue();
        const errors: unknown[] = [];
        const wrapper = mount(NotificationStack, {props: {queue}, attachTo: document.body, global: {config: {errorHandler: (error) => {
            errors.push(error);
        }}}});
        mounted.push(wrapper);
        queue.notify({message: "连接已断开", duration: 0, action: {label: "重试", run: () => {
            throw new Error("重连失败");
        }}});
        await flushPromises();
        button("重试")?.click();
        await flushPromises();
        expect(queue.notifications.value).toEqual([]);
        expect(errors).toMatchObject([{message: "重连失败"}]);
        queue.clearAll();
    });
});
