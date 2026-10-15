/**
 * 把生效工具集交给 OMP：每个工具包成 `AgentTool`，执行时才经句柄取实现，并带上本会话的执行上下文
 * （docs/specs/agent/harness.md 输出 5、6）。
 *
 * 撤回的时序：句柄被撤回时，正在执行的调用立刻以“中断”结算（交给 OMP 的 Promise 先完成），同时中止
 * 实现拿到的 signal；实现之后才完成的结果被丢弃。所以每次调用在会话里恰有一条结果。
 */

import type {AgentTool, AgentToolResult} from "@oh-my-pi/pi-agent-core";
import type {RegisteredTool, ToolRegistry} from "./registry.js";

export const PLUGIN_UNAVAILABLE = "plugin-unavailable";

function unavailableResult(toolId: string, interrupted: boolean): AgentToolResult {
    const text = interrupted ? `工具 ${toolId} 在执行中被撤回，这次调用已中断（${PLUGIN_UNAVAILABLE}）` : `工具 ${toolId} 已不可用（${PLUGIN_UNAVAILABLE}）`;
    return {content: [{type: "text", text}], isError: true, details: {code: PLUGIN_UNAVAILABLE, tool: toolId, interrupted}};
}

export interface BridgedTools {
    readonly agentTools: AgentTool[];
    /** 解除对撤回的订阅；会话关闭时调用。 */
    dispose(): void;
}

export function bridgeTools(tools: readonly RegisteredTool[], session: {readonly sessionId: string; readonly initial: unknown}, registry: ToolRegistry): BridgedTools {
    // 每个工具 id 下正在执行的调用：撤回时逐个以中断结算。
    const inflight = new Map<string, Set<(result: AgentToolResult) => void>>();
    const unsubscribe = registry.onRevoke((id) => {
        const pending = inflight.get(id);
        if (pending === undefined) return;
        inflight.delete(id);
        for (const settle of pending) settle(unavailableResult(id, true));
    });

    const agentTools = tools.map(({declaration, handle}): AgentTool => ({
        name: declaration.name,
        label: declaration.name,
        description: declaration.description,
        parameters: declaration.parameters as AgentTool["parameters"],
        loadMode: "essential",
        concurrency: declaration.concurrency,
        strict: declaration.strict,
        ...(declaration.customFormat === undefined ? {} : {customFormat: declaration.customFormat as AgentTool["customFormat"]}),
        async execute(toolCallId, params, signal, onUpdate) {
            const impl = handle.resolve();
            if (impl === null) return unavailableResult(declaration.id, false);

            const controller = new AbortController();
            const forward = (): void => controller.abort(signal?.reason);
            if (signal?.aborted) controller.abort(signal.reason);
            else signal?.addEventListener("abort", forward, {once: true});

            let settle!: (result: AgentToolResult) => void;
            const revoked = new Promise<AgentToolResult>((resolve) => {
                settle = (result) => {
                    controller.abort(new Error(PLUGIN_UNAVAILABLE));
                    resolve(result);
                };
            });
            const pending = inflight.get(declaration.id) ?? new Set();
            pending.add(settle);
            inflight.set(declaration.id, pending);

            const running = impl.execute(params as Record<string, unknown>, {sessionId: session.sessionId, toolCallId, initial: session.initial, signal: controller.signal}, onUpdate);
            // 撤回先结算时 running 的完成或失败没有人等；挂上处理免得变成未处理的拒绝。
            running.catch(() => undefined);
            try {
                return await Promise.race([running, revoked]);
            } finally {
                pending.delete(settle);
                signal?.removeEventListener("abort", forward);
            }
        },
    }));

    return {agentTools, dispose: unsubscribe};
}
