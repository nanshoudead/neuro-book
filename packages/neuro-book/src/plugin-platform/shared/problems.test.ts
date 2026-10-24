/**
 * 插件页的问题读模型（docs/specs/runtime/plugin-install.md 的插件页）：真实内核实例的目录里，只取本位置的入口；入口激活失败
 * 带错误消息、受阻带原因与键；被拒的贡献合并插件顶层与入口下的；结果是纯 JSON（没有声明与实现），按插件与种类排好。
 */

import {afterEach, describe, expect, it} from "bun:test";

import type {Application} from "@notnotype/nb-runtime/application";
import {defineServiceKey} from "@notnotype/nb-runtime/services";

import {createApplication} from "nbook/application";

import {pluginProblems} from "./problems";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const missingKey = defineServiceKey<object>("acme.nowhere/missing");

describe("pluginProblems", () => {
    it("本位置的入口失败与受阻、顶层与入口下被拒的贡献；别处的入口不算；不带实现", async () => {
        const application = createApplication(
            {identity: {location: "server", instanceId: "problems"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                gates: [],
                plugins: [
                    {id: "acme.owner", contributionPoints: [{id: "acme.owner.items", implementation: "required", idPrefix: "plugin"}], entries: []},
                    {
                        id: "example.broken",
                        entries: [
                            {id: "server", location: "server", activationEvents: ["onStartup"], activate: () => {
                                throw new Error("local 记录需要客户端身份");
                            }},
                            // 别处的入口：浏览器里才激活，服务端的问题里没有它。
                            {id: "browser", location: "browser", activationEvents: ["onStartup"], activate: () => {
                                throw new Error("不会在服务端执行");
                            }},
                        ],
                    },
                    {id: "example.blocked", entries: [{id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: missingKey}], activate: () => ({})}]},
                    {
                        id: "example.intruder",
                        // 顶层声明与入口下的贡献都被拒：入口下的用了别人的前缀。
                        contributions: [{capability: "acme.owner.items", id: "acme.owner.top", declaration: {}}],
                        entries: [{id: "server", location: "server", activationEvents: ["onStartup"], contributions: [{capability: "acme.owner.items", id: "acme.owner.inner", declaration: {}}], activate: () => ({contributions: {"acme.owner.items": {"acme.owner.inner": {}}}})}],
                    },
                ],
            },
        );
        started.push(application);
        await application.startup;
        const problems = pluginProblems(application.plugins.catalog(), "server");
        expect(problems).toEqual([
            {kind: "entry-blocked", plugin: "example.blocked", entry: "server", location: "server", reason: "missing-service", key: "acme.nowhere/missing"},
            {kind: "entry-failed", plugin: "example.broken", entry: "server", location: "server", stage: "activate", reason: "activation-threw", message: "local 记录需要客户端身份"},
            // 顶层声明投给要实现的贡献点：内核先以 implementation-required 拒绝。
            {kind: "contribution-rejected", plugin: "example.intruder", entry: null, location: "server", capability: "acme.owner.items", id: "acme.owner.top", reason: "implementation-required", detail: null},
            {kind: "contribution-rejected", plugin: "example.intruder", entry: "server", location: "server", capability: "acme.owner.items", id: "acme.owner.inner", reason: "invalid-declaration", detail: expect.stringContaining("example.intruder")},
        ]);
        // 纯 JSON：经 JSON 往返不变（没有实现对象、函数）。
        expect(JSON.parse(JSON.stringify(problems))).toEqual(problems);
    });
});
