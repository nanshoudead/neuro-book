/**
 * 包入口的 smoke：按包名导入（与宿主一样经 package.json 的 exports 解析），跑一条最小的真实路径。内部模块各自的测试
 * 用相对路径，测不到入口漏导出或 exports 写错。
 */

import {describe, expect, it} from "bun:test";

import {buildTurns, createAgentViewRegistry, createHarnessTranscript, formatText, textOf} from "@notnotype/nb-agent-ui";

describe("核心入口", () => {
    it("从包名导入：适配器把一段日志画成消息，分轮把它们分成一轮，文字按语言取", () => {
        const transcript = createHarnessTranscript({locale: "en-US"});
        transcript.applyLogEntry({kind: "agent_message", seq: 1, at: "2026-10-22T08:00:00.000Z", message: {role: "user", content: "你好", timestamp: 1}});
        transcript.applyLogEntry({kind: "agent_message", seq: 2, at: "2026-10-22T08:00:01.000Z", message: {role: "assistant", content: [{type: "text", text: "在。"}], stopReason: "stop", timestamp: 2}});
        const messages = [...transcript.messages()];
        const registry = createAgentViewRegistry([]);
        const turns = buildTurns({messages, registry, run: {status: "idle", phase: ""}, history: {hasMore: false, loading: false, error: null}, now: 3});
        expect(turns).toHaveLength(1);
        expect(textOf(formatText({"zh-CN": "{n} 轮", "en-US": "{n} turn"}, {n: turns.length}), "en-US")).toBe("1 turn");
    });
});
