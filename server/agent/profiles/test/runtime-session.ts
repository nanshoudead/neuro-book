import {resolve} from "node:path";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    normalizeWorkspaceRootRef,
    resolveWorkspaceRootRef,
} from "nbook/server/workspace-files/workspace-root-ref";
import {WORKSPACE_CONTAINER_ROOT} from "nbook/server/workspace-files/workspace-root-ref";

/**
 * 创建遵守正式逻辑引用与物理root分离合同的Profile测试session。
 *
 * 测试默认managed Workspace Root是当前测试进程的`workspace/`；需要隔离State
 * Root的测试必须显式传入第二个参数，不能让fixture自行从session字符串猜cwd。
 */
export function createTestRuntimeSession(
    input: Partial<NeuroSessionContext> = {},
    managedWorkspaceRoot: AbsoluteFsPath = absoluteFsPath(resolve("workspace")),
): RuntimeSessionFacade {
    const workspaceRoot = input.workspaceRoot ?? WORKSPACE_CONTAINER_ROOT;
    const workspaceRootRef = normalizeWorkspaceRootRef(workspaceRoot, input.projectPath);
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        workspaceRoot,
        customState: {},
        linkedAgents: [],
        archived: false,
        agentMode: "normal",
        ...input,
        workspaceFsRoot: resolveWorkspaceRootRef(workspaceRootRef, managedWorkspaceRoot),
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: session.profileKey,
                        initial: {},
                        workspaceRoot: session.workspaceRoot,
                        workspaceKey: "test",
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return session;
}
