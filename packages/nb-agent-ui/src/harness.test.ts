import {describe, expect, it} from "bun:test";

import {createHarnessTranscript} from "./harness";

const AT = "2026-10-22T08:00:00.000Z";
let seq = 0;
const entry = (kind: string, fields: Record<string, unknown> = {}) => ({kind, seq: ++seq, at: AT, ...fields});
const userEntry = (text: string) => entry("agent_message", {message: {role: "user", content: text, timestamp: 1}});
const assistantEntry = (content: unknown[], stopReason = "stop", timestamp = 2) => entry("agent_message", {message: {role: "assistant", content, model: "scripted", stopReason, timestamp}});
const resultEntry = (toolCallId: string, text: string, isError = false) => entry("agent_message", {message: {role: "toolResult", toolCallId, toolName: "lookup", content: [{type: "text", text}], isError, timestamp: 3}});
const usageEntry = (cost: number | null) => entry("usage", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost});
const call = (id: string) => ({type: "toolCall", id, name: "lookup", arguments: {query: "雨夜"}});

describe("harness 适配器：日志", () => {
    it("用户消息、助手的文字与思考、工具调用与结果按 toolCallId 配对；用量挂在所在的助手消息上，单价未知保留为 null", () => {
        const transcript = createHarnessTranscript();
        for (const item of [
            userEntry("第三章里谁知道钟声的秘密？"),
            assistantEntry([{type: "thinking", thinking: "先查。"}, {type: "text", text: "我查一下。"}, call("c1")], "toolUse"),
            usageEntry(null),
            resultEntry("c1", "林默在第三章听到了钟声。"),
            assistantEntry([{type: "text", text: "林默知道。"}]),
            usageEntry(0),
        ]) transcript.applyLogEntry(item);

        const [user, first, second] = transcript.messages();
        expect(user).toMatchObject({kind: "user", blocks: [{kind: "text", text: "第三章里谁知道钟声的秘密？"}], intent: "normal"});
        expect(first).toMatchObject({kind: "assistant", status: "done", text: "我查一下。", thinking: "先查。", usage: {input: 10, cost: null}});
        expect(first?.kind === "assistant" && first.toolCalls).toEqual([{id: "c1", name: "lookup", status: "success", args: {query: "雨夜"}, result: {text: "林默在第三章听到了钟声。", truncated: false}}]);
        expect(second).toMatchObject({kind: "assistant", text: "林默知道。", usage: {cost: 0}});
        expect(transcript.problems()).toEqual([]);
    });

    it("运行出错：末尾一条按错误类型写成的说明，不带 provider 的原文；可重试的类型标为可重试", () => {
        const transcript = createHarnessTranscript({locale: "en-US"});
        transcript.applyLogEntry(entry("session_snapshot", {profile: {key: "qa", version: "1"}, initial: {}, tools: []}));
        transcript.applyLogEntry(entry("run_end", {stopReason: "error", error: {kind: "auth", status: null, message: "Missing env NB_KEY"}}));
        expect(transcript.messages()).toEqual([{kind: "error", id: expect.any(String), timestamp: Date.parse(AT), message: "The model service key is missing or invalid. Check the settings.", retryable: false}]);

        const network = createHarnessTranscript();
        network.applyLogEntry(entry("run_end", {stopReason: "error", error: {kind: "network", status: null, message: "ECONNRESET"}}));
        expect(network.messages()[0]).toMatchObject({kind: "error", message: "网络连接出错，请稍后重试。", retryable: true});
    });

    // 真实 harness 停止时会先写工具结果与一条中止的助手消息（见 harness.contract.test.ts）；这里测的是日志被截断时的降级。
    it("截断的日志：run_end 时还没有结果的工具调用标为出错，最后一条助手消息标为已停止", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(userEntry("查"));
        transcript.applyLogEntry(assistantEntry([call("c9")], "toolUse"));
        transcript.applyLogEntry(entry("run_end", {stopReason: "aborted", error: null}));
        const last = transcript.messages().at(-1);
        expect(last).toMatchObject({kind: "assistant", status: "stopped"});
        expect(last?.kind === "assistant" && last.toolCalls[0]?.status).toBe("error");
    });

    it("已经交出去的消息对象不再改动：工具结果到了换一个新对象", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(assistantEntry([call("c2")], "toolUse"));
        const before = transcript.messages()[0];
        transcript.applyLogEntry(resultEntry("c2", "好"));
        expect(before?.kind === "assistant" && before.toolCalls[0]?.status).toBe("running");
        expect(transcript.messages()[0]).not.toBe(before);
    });

    it("写坏的输入跳过并记进 problems，不抛异常；重复或更旧的 seq 忽略", () => {
        const transcript = createHarnessTranscript();
        const good = userEntry("你好");
        for (const item of [
            null,
            "不是对象",
            {kind: "agent_message", at: AT},
            good,
            good,
            entry("agent_message", {message: "不是对象"}),
            entry("agent_message", {message: {role: "assistant", content: [{type: "toolCall", id: 7}], stopReason: "toolUse"}}),
            assistantEntry([call("c3")], "toolUse"),
            assistantEntry([call("c3")], "toolUse"),
            resultEntry("c-missing", "没有对应的调用"),
            entry("usage", {input: "十"}),
            entry("something_new"),
            entry("agent_message", {message: {role: "assistant"}}),
            entry("agent_message", {message: {role: "toolResult", toolCallId: "c3", toolName: "lookup"}}),
            entry("agent_message", {message: {role: "user"}}),
        ]) expect(() => transcript.applyLogEntry(item)).not.toThrow();
        expect(transcript.messages().map((message) => message.kind)).toEqual(["user", "assistant", "assistant", "assistant"]);
        expect(transcript.problems().map((problem) => problem.reason)).toEqual([
            "条目不是对象",
            "条目不是对象",
            "条目缺 seq 或 kind",
            "agent_message 的 message 不是对象",
            "工具调用缺 id 或 name",
            "工具调用 id 重复：c3",
            "工具结果找不到对应的调用：c-missing",
            "usage 缺数字字段",
            "不认识的条目：something_new",
            "助手消息缺 content 或 stopReason",
            "工具结果缺 content 或 isError",
            "用户消息缺 content",
        ]);
    });
});

describe("harness 适配器：事件", () => {
    const streaming = (text: string, content: unknown[] = []) => ({type: "message_update", message: {role: "assistant", content: [{type: "text", text}, ...content], model: "scripted", timestamp: 5}});

    it("运行中只有事件时显示正在生成的那条，工具跑完前后的状态跟着事件变；日志里这条到了就换成日志版本", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(userEntry("查"));
        transcript.applyEvent({type: "message_start", message: {role: "assistant", content: [], model: "scripted", timestamp: 5}});
        transcript.applyEvent(streaming("我查"));
        expect(transcript.messages().at(-1)).toMatchObject({kind: "assistant", status: "streaming", text: "我查"});
        transcript.applyEvent(streaming("我查一下。", [call("c4")]));
        transcript.applyEvent({type: "message_end", message: {role: "assistant", content: [], stopReason: "toolUse"}});
        transcript.applyEvent({type: "tool_execution_start", toolCallId: "c4", toolName: "lookup", args: {}});

        // 日志里这条助手消息到了：临时版本作废，工具的临时状态照样盖在日志版本上。
        transcript.applyLogEntry(assistantEntry([{type: "text", text: "我查一下。"}, call("c4")], "toolUse", 5));
        expect(transcript.messages()).toHaveLength(2);
        const logged = transcript.messages()[1];
        expect(logged).toMatchObject({kind: "assistant", status: "done", text: "我查一下。"});
        expect(logged?.kind === "assistant" && logged.toolCalls[0]?.status).toBe("running");

        transcript.applyEvent({type: "tool_execution_end", toolCallId: "c4", toolName: "lookup", result: {content: [{type: "text", text: "找到了"}]}, isError: false});
        const ended = transcript.messages()[1];
        expect(ended?.kind === "assistant" && ended.toolCalls[0]).toMatchObject({status: "success", result: {text: "找到了"}});
    });

    it("agent_end 清掉临时内容；认不出的事件记进 problems，其余无关事件忽略", () => {
        const transcript = createHarnessTranscript();
        transcript.applyEvent(streaming("一半"));
        transcript.applyEvent({type: "turn_start"});
        transcript.applyEvent({type: "agent_end", messages: []});
        expect(transcript.messages()).toEqual([]);
        for (const event of [null, {type: 3}, {type: "message_update"}, {type: "tool_execution_start"}, {type: "future_agent_event"}]) expect(() => transcript.applyEvent(event)).not.toThrow();
        expect(transcript.problems().map((problem) => problem.reason)).toEqual(["不是带 type 的对象", "不是带 type 的对象", "缺 message", "缺 toolCallId", "不认识的事件：future_agent_event"]);
    });
});

describe("harness 适配器：日志与事件交错", () => {
    it("工具结果的日志先到，晚到的工具结束事件不再盖掉日志里的结构化结果", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(assistantEntry([call("t1")], "toolUse"));
        transcript.applyLogEntry(entry("agent_message", {message: {role: "toolResult", toolCallId: "t1", toolName: "task_create", content: [{type: "text", text: "created"}], details: {title: "审查", items: [1]}, isError: false}}));
        transcript.applyEvent({type: "tool_execution_end", toolCallId: "t1", toolName: "task_create", result: {content: [{type: "text", text: "created"}]}, isError: false});
        const assistant = transcript.messages()[0];
        expect(assistant?.kind === "assistant" && assistant.toolCalls[0]?.result).toEqual({text: "created", truncated: false, details: {title: "审查", items: [1]}});
    });

    it("工具结束事件先到时，临时结果带上结构化结果", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(assistantEntry([call("t2")], "toolUse"));
        transcript.applyEvent({type: "tool_execution_end", toolCallId: "t2", toolName: "task_create", result: {content: [{type: "text", text: "created"}], details: {title: "审查"}}, isError: false});
        const assistant = transcript.messages()[0];
        expect(assistant?.kind === "assistant" && assistant.toolCalls[0]?.result?.details).toEqual({title: "审查"});
    });

    it("前一条助手消息的日志晚到，不清掉正在生成的下一条", () => {
        const transcript = createHarnessTranscript();
        transcript.applyEvent({type: "message_start", message: {role: "assistant", content: [{type: "text", text: "第二条"}], timestamp: 20}});
        transcript.applyLogEntry(assistantEntry([call("c7")], "toolUse", 10));
        expect(transcript.messages().map((message) => (message.kind === "assistant" ? [message.status, message.text] : message.kind))).toEqual([["done", ""], ["streaming", "第二条"]]);
        transcript.applyLogEntry(assistantEntry([{type: "text", text: "第二条"}], "stop", 20));
        expect(transcript.messages().map((message) => (message.kind === "assistant" ? message.status : message.kind))).toEqual(["done", "done"]);
    });

    it("模型还没开口就被停止：补一条已停止的空回复", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(userEntry("查"));
        transcript.applyLogEntry(entry("run_end", {stopReason: "aborted", error: null}));
        expect(transcript.messages().map((message) => (message.kind === "assistant" ? message.status : message.kind))).toEqual(["user", "stopped"]);
    });

    it("用户消息的文字与图片按原来的先后排；图片字节数扣掉 base64 补位", () => {
        const transcript = createHarnessTranscript();
        transcript.applyLogEntry(entry("agent_message", {message: {role: "user", timestamp: 1, content: [
            {type: "text", text: "前"},
            {type: "image", data: "AQ==", mimeType: "image/png"},
            {type: "text", text: "后"},
            {type: "image", data: "AQI=", mimeType: "image/png"},
        ]}}));
        const user = transcript.messages()[0];
        expect(user?.kind === "user" && user.blocks.map((block) => (block.kind === "text" ? block.text : block.bytes))).toEqual(["前", 1, "后", 2]);
    });
});
