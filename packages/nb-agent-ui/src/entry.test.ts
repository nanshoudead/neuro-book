/**
 * 包入口的 smoke：按包名导入（与宿主一样经 package.json 的 exports 解析），跑一条最小的真实路径。内部模块各自的测试
 * 用相对路径，测不到入口漏导出或 exports 写错。
 */

import {describe, expect, it} from "bun:test";

import {acceptSubmission, createAgentContext, createHarnessTranscript, formatText, textOf} from "@notnotype/nb-agent-ui";

describe("核心入口", () => {
    it("从包名导入：适配器把一段日志画成消息放进起步的 ctx，受理发送后草稿换版本，文字按语言取", () => {
        const transcript = createHarnessTranscript({locale: "en-US"});
        transcript.applyLogEntry({kind: "agent_message", seq: 1, at: "2026-10-22T08:00:00.000Z", message: {role: "user", content: "你好", timestamp: 1}});
        transcript.applyLogEntry({kind: "agent_message", seq: 2, at: "2026-10-22T08:00:01.000Z", message: {role: "assistant", content: [{type: "text", text: "在。"}], stopReason: "stop", timestamp: 2}});
        const ctx = createAgentContext({messages: transcript.messages(), composer: {draft: {text: "你好", version: 1}}});
        expect(ctx.messages.map((message) => message.kind)).toEqual(["user", "assistant"]);
        expect(acceptSubmission(ctx.composer).draft).toEqual({text: "", version: 2});
        expect(textOf(formatText({"zh-CN": "{n} 条", "en-US": "{n} messages"}, {n: ctx.messages.length}), "en-US")).toBe("2 messages");
    });
});
