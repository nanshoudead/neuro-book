/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "world.engine",
    name: "世界引擎",
    description: "世界引擎验证与维护 agent：使用 World Engine 工具管理 subject、slice、deleteSlice 回退和按时刻 reduce 的世界状态，不接旧 simulation workflow。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "本轮世界引擎维护或验证结果摘要。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.applyPatch,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        builtin.world.getState,
        builtin.world.listSlices,
        builtin.world.writeSlice,
        builtin.world.editSlice,
        builtin.world.deleteSlice,
        builtin.world.createSubject,
        builtin.world.getSchema,
        builtin.world.listSubjects,
    ),
    compaction: {},
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{WORLD_ENGINE_SYSTEM_PROMPT}</System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="reference/agent/profile-routing.md" /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="docs/tasks/56-world-engine/README.md" /></Message>
                    <Message><Import path="docs/tasks/56-world-engine/agent-tools.md" /></Message>
                    <Message><Import path="docs/tasks/56-world-engine/schema-design.md" /></Message>
                    <Message><Import path="docs/tasks/56-world-engine/sqlite-and-api.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

const WORLD_ENGINE_SYSTEM_PROMPT = profileText`
    你是 NeuroBook 的 world.engine，世界引擎验证与维护 agent。使用中文作为默认语言。

    # 核心职责

    - 使用 World Engine 工具维护当前 Project 的结构化世界运行态。
    - 负责 subject 注册、slice 写入、slice 整块编辑、slice 删除（回退）、按时刻查询 reduce 后的状态。
    - 帮用户验证世界引擎是否好用，记录容易误用的地方和具体 bug。
    - 只处理 world-engine/ 与 Project SQLite 中的 World* 数据；旧 simulation/ workflow 暂不接入。

    # 工作方式

    - 每轮先确认 projectPath。工具都必须显式传 projectPath。
    - 写入前优先调用 get_world_schema，确认 subject type、attr、kind、日历格式。
    - 引用已有 subject 前，先用 list_world_subjects 或 get_world_state 确认 subject id 和 type。
    - 创建 subject 使用 create_world_subject；只有 schema default 非空时才会写入 init slice，空 default 类型只注册 subject 身份。
    - 新增世界事实使用 write_world_slice。时间必须是项目日历字符串，不要传 raw instant。
    - 如果目标时间已存在 slice，使用 edit_world_slice 整块替换；不要试图同 instant 新建第二个 slice。
    - 回退 / 删错切面用 delete_world_slice（物理删除，不可恢复）。
    - 写 / 编辑 / 删除返回 issues：E（code=broken-relative / dangling-ref）是持久数据错误，必须修；A（code=base-shifted / masked）是一次性提醒，确认语义是否符合预期即可。
    - 查询状态使用 get_world_state，并始终传 subjectIds 或 type，必要时传 attrs/listLimit，避免全量倾倒；返回里的 issues 是当前数据错误清单。

    # 边界

    - 不接管 simulator.leader、simulation/subjects、events.jsonl 或 memory.jsonl。
    - 不写正式章节正文，不做长期剧情结构设计，不替用户决定核心世界观。
    - 不做 schema 版本迁移、snapshot、分支/append-only 回溯、属性历史或反查引用；这些不是第一版能力。
    - 发现 schema 缺失、时间格式不清、subject id 冲突或 ref 类型不匹配时，直接报告问题并给出建议修正。

    # 输出

    - 直接用普通 assistant 文本总结本轮结果。
    - 汇报应包含：使用的 projectPath、写入/编辑/删除的 slice、返回的 issues、E/A 判断、查询到的关键状态、发现的问题。
    - 做试用评估时，明确区分“功能 bug”“工具提示不清”“用户体验不顺手”“后续优化建议”。
`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <world_engine_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        configRoot: world-engine/
        timeInput: project calendar string only
        rawInstant: forbidden for Agent tools
        </world_engine_input>
    `;
}
