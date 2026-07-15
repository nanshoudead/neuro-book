import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentSessionEventDto, AgentSessionLiveStateDto, AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";

describe("useAgentSession event reducer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("event epoch 换代和 seq gap 都请求统一 recovery", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(3));

        session.applyEvent({eventEpoch: "epoch-2", seq: 1, sessionId: 1, kind: "session", event: {type: "connected", eventEpoch: "epoch-2", latestSeq: 1}});
        expect(session.recoveryReasons.value).toContain("event_epoch_changed");

        session.applyRecovery(recovery(3));
        session.applyEvent(control(5, {type: "invocation_aborted"}));
        expect(session.recoveryReasons.value).toContain("seq_gap");
    });

    it("轻量 live state 立即更新 shell，revision 变化时请求 recovery", () => {
        const session = useAgentSession();
        session.applyRecovery({...recovery(0), activePathRevision: "rev-1"});

        session.applyLiveState({...liveState(), agentMode: "plan", activePathRevision: "rev-2"});

        expect(session.recoveryShell.value?.agentMode).toBe("plan");
        expect(session.recoveryShell.value?.activePathRevision).toBe("rev-2");
        expect(session.recoveryReasons.value).toContain("active_path_changed");
    });

    it("relations 和 queue 事件只更新 recovery shell，不重建 durable history", () => {
        const session = useAgentSession();
        session.applyRecovery({...recovery(0), history: {entries: [{id: "user-1", timestamp: 1, type: "user", intent: "normal", content: {preview: "你好", bytes: 6, omitted: false}}], previousCursor: null}});

        session.applyRelations({sessionId: 1, linkedAgents: [{...summary(), sessionId: 2}], linkedByAgents: []});
        session.applyEvent(control(1, {type: "steer_queued", item: {id: "steer-1", kind: "steer", text: {preview: "调整", bytes: 6, omitted: false}, images: [], omittedImages: 0, createdAt: 1}}));
        session.applyEvent(control(2, {type: "follow_up_queued", item: {id: "follow-1", kind: "followup", text: {preview: "继续", bytes: 6, omitted: false}, images: [], omittedImages: 0, createdAt: 2}}));

        expect(session.recoveryShell.value?.linkedAgents.map((item) => item.sessionId)).toEqual([2]);
        expect(session.recoveryShell.value?.steerQueue.items.map((item) => item.id)).toEqual(["steer-1"]);
        expect(session.recoveryShell.value?.followUpQueue.items.map((item) => item.id)).toEqual(["follow-1"]);
        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["user-1"]);
    });

    it("runtime message_update 在一帧内批量合并，durable entry 到达后收敛 live overlay", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(0));
        session.applyEvent(runtime(1, {type: "message_start", messageId: "assistant-1", role: "assistant", timestamp: 1, model: "test"}));
        session.applyEvent(runtime(2, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "你", deltaBytes: 3, deltaOmitted: false}}));
        session.applyEvent(runtime(3, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "好", deltaBytes: 3, deltaOmitted: false}}));

        await vi.runAllTimersAsync();
        expect(session.messages.value.at(-1)?.content).toBe("你好");
        expect(session.messages.value.at(-1)?.projectionSource).toBe("live");

        session.applyEvent(control(4, {
            type: "session_entry",
            entry: {
                id: "assistant-1",
                timestamp: 1,
                type: "assistant",
                content: {preview: "你好", bytes: 6, omitted: false},
                thinking: {preview: "", bytes: 0, omitted: false},
                status: "done",
                model: "test",
                usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            toolCalls: [],
            omittedToolCalls: 0,
            },
        }));

        expect(session.messages.value).toEqual([expect.objectContaining({id: "assistant-1", projectionSource: "durable"})]);
        expect(session.liveOverlay.value).toEqual([]);
    });

    it("长 durable history 运行期间不会复制进 live overlay", () => {
        const session = useAgentSession();
        const entries = Array.from({length: 300}, (_, index) => ({
            id: `user-${String(index)}`,
            timestamp: index,
            type: "user" as const,
            intent: "normal" as const,
            content: {preview: `message-${String(index)}`, bytes: 10, omitted: false},
        }));
        session.applyRecovery({...recovery(0), history: {entries, previousCursor: null}});

        session.applyEvent(runtime(1, {type: "message_start", messageId: "live-1", role: "assistant", timestamp: 1, model: "test"}));

        expect(session.messages.value).toHaveLength(301);
        expect(session.liveOverlay.value).toEqual([expect.objectContaining({id: "live-1", projectionSource: "live"})]);
        expect(session.liveOverlay.value.some((message) => message.projectionSource === "durable")).toBe(false);
    });

    it("duplicate/replayed event 不会重复应用", () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(0));
        const entryEvent = control(1, {type: "session_entry", entry: {id: "user-1", timestamp: 1, type: "user", intent: "normal", content: {preview: "你好", bytes: 6, omitted: false}}});

        session.applyEvent(entryEvent);
        session.applyEvent(entryEvent);

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["user-1"]);
        expect(session.lastSeq.value).toBe(1);
    });
});

function recovery(after: number): AgentSessionRecoveryDto {
    return {
        kind: "recovery",
        eventCursor: {eventEpoch: "epoch-1", after},
        summary: summary(),
        activeLeafId: null,
        activePathRevision: null,
        history: {entries: [], previousCursor: null},
        tree: [],
        linkedAgents: [],
        linkedByAgents: [],
        pendingUserInputs: [],
        steerQueue: {items: [], omittedItems: 0},
        followUpQueue: {status: "ready", items: [], omittedItems: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function liveState(): AgentSessionLiveStateDto {
    const value = recovery(0);
    return {
        summary: value.summary,
        activeLeafId: value.activeLeafId,
        activePathRevision: value.activePathRevision,
        pendingUserInputs: [],
        steerQueue: {count: 0},
        followUpQueue: {status: value.followUpQueue.status, count: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function summary(): AgentSessionRecoveryDto["summary"] {
    return {sessionId: 1, profileKey: "leader.default", workspaceKey: "global", workspaceRoot: ".", status: "idle", updatedAt: 1, archived: false};
}

function control(seq: number, event: Extract<AgentSessionEventDto, {kind: "session"}>["event"]): AgentSessionEventDto {
    return {eventEpoch: "epoch-1", seq, sessionId: 1, kind: "session", event};
}

function runtime(seq: number, event: Extract<AgentSessionEventDto, {kind: "runtime"}>["event"]): AgentSessionEventDto {
    return {eventEpoch: "epoch-1", seq, sessionId: 1, invocationId: "run-1", kind: "runtime", event};
}
