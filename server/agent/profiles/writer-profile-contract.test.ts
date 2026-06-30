import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import writerProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/writer.profile";
import {DEFAULT_WRITING_REFERENCE_PRESET} from "nbook/server/agent/profiles/writer-writing-reference";
import {DEFAULT_WRITING_STYLE_PRESET} from "nbook/server/agent/profiles/writer-writing-style";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";

describe("writer profile contract", () => {
    it("暴露正文写作 profile 基础合同", () => {
        expect(writerProfile.manifest.key).toBe("writer");
        expect(writerProfile.manifest.name).toBe("正文写作");
        expect(writerProfile.initialSchema).toBeDefined();
        expect(writerProfile.payloadSchema).toBeDefined();
        expect(writerProfile.outputSchema).toBeDefined();
    });

    it("拥有文件工具和 readonly World Engine，但不持有 Plot tools", () => {
        const toolKeys = writerProfile.rootToolKeys;

        expect(toolKeys).toContain("read");
        expect(toolKeys).toContain("write");
        expect(toolKeys).toContain("edit");
        expect(toolKeys).toContain("bash");
        expect(toolKeys).toContain("execute_world");
        expect(toolKeys).toContain("report_result");
        expect(toolKeys).not.toContain("apply_patch");
        expect(toolKeys).not.toContain("write_world_slice");
        expect(toolKeys).not.toContain("delete_world_slice");
        expect(toolKeys).not.toContain("get_plot_tree");
        expect(toolKeys).not.toContain("get_story_thread");
        expect(toolKeys).not.toContain("get_story_scene_context");
        expect(toolKeys).not.toContain("get_story_plot_context");
        expect(toolKeys).not.toContain("get_chapter_plot");
        expect(toolKeys).not.toContain("get_chapter_writer_brief");
        expect(toolKeys).not.toContain("create_story_scene");
    });

    it("提示词允许消费 leader brief，但禁止自行读取 Plot", async () => {
        const projectSlug = `writer-project-${randomUUID()}`;
        const projectRoot = resolve("workspace", projectSlug);
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Writer Contract\nsummary: \"\"\n", "utf8");
        try {
            const prepared = await writerProfile.prepare!({
                session: testSession({
                    profileKey: "writer",
                    workspaceRoot: resolve("workspace"),
                }),
                initial: {},
                settings: defaultWriterSettings(),
                invocation: {
                    message: "请根据上游 Scene / World Context brief 写正文。",
                    payload: {
                        path: `${projectSlug}/manuscript/001-chapter/index.md`,
                        context: {
                            threadIds: ["thread-main"],
                            sceneIds: ["scene-main"],
                            plotIds: ["plot-legacy"],
                            lorebookEntries: [`${projectSlug}/lorebook/character/hero/`],
                            readablePaths: [`${projectSlug}/manuscript/000-prologue/index.md`],
                        },
                    },
                    caller: {kind: "user"},
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const historyContext = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
            const writerInputContext = historyContext.slice(historyContext.indexOf("<writer_input_context>"));

            expect(systemPrompt).toContain("Scene / World Context brief");
            expect(systemPrompt).toContain("你不持有 Plot tools");
            expect(systemPrompt).toContain("leader（或手动 director）");
            expect(systemPrompt).not.toContain("上游 leader/director");
            expect(historyContext).toContain("<writer_input_context>");
            expect(historyContext).toContain(`path: ${projectSlug}/manuscript/001-chapter/index.md`);
            expect(historyContext).toContain("chapterPath: manuscript/001-chapter/");
            expect(writerInputContext).not.toContain("thread-main");
            expect(writerInputContext).not.toContain("scene-main");
            expect(writerInputContext).not.toContain("plot-legacy");
            expect(writerInputContext).toContain(`${projectSlug}/lorebook/character/hero/`);
            expect(writerInputContext).toContain(`${projectSlug}/manuscript/000-prologue/index.md`);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });
});

/**
 * 创建 writer profile 测试使用的默认 settings。
 */
function defaultWriterSettings() {
    return {
        writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
        writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
        narrativePerson: "third" as const,
        paragraphRhythm: "段落节奏偏短段分行。",
        wordCountControl: "2000-2600 字",
        polishingWorkflow: "使用 stop-slop 做自查。",
        adultStylePrompt: "",
    };
}

function testSession(input: Partial<NeuroSessionContext>): RuntimeSessionFacade {
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        workspaceRoot: "workspace",
        customState: {},
        linkedAgents: [],
        archived: false,
        planModeActive: false,
        ...input,
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
