/**
 * 激活上下文的 `onStop`（docs/specs/runtime/plugins.md 的激活上下文）：登记的事在这一代入口停止时执行；激活失败时同样
 * 执行；这一代收口之后再登记抛错。用真实的运行实例与插件宿主。
 */

import {describe, expect, it} from "bun:test";

import {createApplication} from "../application/application";
import {LifecycleStateError} from "../lifecycle/lifecycle";
import type {ActivationContext, PluginDefinition} from "./plugins";

function startApp(plugins: ReadonlyArray<PluginDefinition>) {
    return createApplication({identity: {location: "server", instanceId: "on-stop"}, stopSignal: new AbortController().signal, emergency: () => undefined}, {plugins, gates: []});
}

describe("onStop", () => {
    it("入口停止时执行登记的事；收口之后再登记抛 LifecycleStateError", async () => {
        const log: string[] = [];
        let kept: ActivationContext | null = null;
        const app = startApp([{id: "acme.timer", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            kept = context;
            context.onStop(() => void log.push("timer cancelled"));
            context.onStop(async () => {
                await Promise.resolve();
                log.push("handle closed");
            });
            return {};
        }}]}]);
        expect(await app.startup).toMatchObject({status: "available"});
        expect(log).toEqual([]);
        expect(await app.stop()).toEqual({status: "closed"});
        expect([...log].sort()).toEqual(["handle closed", "timer cancelled"]);
        expect(() => kept!.onStop(() => undefined)).toThrow(LifecycleStateError);
    });

    it("激活失败时，失败之前登记的事同样执行", async () => {
        const log: string[] = [];
        const app = startApp([{id: "acme.broken", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            context.onStop(() => void log.push("released"));
            throw new Error("激活到一半失败");
        }}]}]);
        expect(await app.startup).toMatchObject({failures: [{source: "acme.broken/main"}]});
        expect(log).toEqual(["released"]);
        await app.stop();
    });
});
