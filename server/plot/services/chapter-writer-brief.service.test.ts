import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {ChapterWriterBriefService} from "nbook/server/plot/services/chapter-writer-brief.service";
import type {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import type {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import type {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {
    SceneWorldContextDto,
    StorySceneWorldAnchorDto,
} from "nbook/shared/dto/plot.dto";
import {describe, expect, it, vi} from "vitest";

const chapterPath = "manuscript/001/001-opening/";

describe("ChapterWriterBriefService", () => {
    it("ready：生成包含 Scene、Thread 和 World Context 的 writer markdown", async () => {
        const {service, sceneWorldContextService} = createService([createRecord()]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterPath);

        expect(brief.status).toBe("ready");
        expect(brief.totalScenes).toBe(1);
        expect(brief.scenes[0]).toMatchObject({
            title: "神殿相遇",
            threadSummary: "主线推进到神殿。",
            writingTip: "突出压迫感。",
            worldContext: {
                slices: [{title: "相关切面"}],
            },
        });
        expect(sceneWorldContextService.getSceneWorldContextForScene).toHaveBeenCalledOnce();
        expect(brief.suggestedBriefMarkdown).toContain("神殿相遇");
        expect(brief.suggestedBriefMarkdown).toContain("主线推进到神殿。");
        expect(brief.suggestedBriefMarkdown).toContain("突出压迫感。");
        expect(brief.suggestedBriefMarkdown).toContain("相关切面");
        expect(brief.suggestedBriefMarkdown).toContain("主角(character)");
        expect(brief.suggestedBriefMarkdown).not.toContain("attrs");
        expect(brief.suggestedBriefMarkdown).not.toContain("\"hp\"");
        expect(brief.suggestedBriefMarkdown).not.toContain("POV");
        expect(brief.suggestedBriefMarkdown).not.toContain("tone");
        expect(brief.suggestedBriefMarkdown).not.toContain("do-not-reveal");
    });

    it("needs_plot：章节没有关联 Scene 时要求先补 Plot", async () => {
        const {service, sceneWorldContextService} = createService([]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterPath);

        expect(brief.status).toBe("needs_plot");
        expect(brief.scenes).toEqual([]);
        expect(brief.warnings).toEqual(["本章节尚未关联 Plot Scene；请先让 director 建立章节 Scene 顺序。"]);
        expect(brief.suggestedBriefMarkdown).toContain("本章节尚未关联 Plot Scene");
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_anchor：Scene 缺少完整时间范围时不查询 World Context", async () => {
        const {service, sceneWorldContextService} = createService([
            createRecord({startInstant: null}),
        ]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterPath);

        expect(brief.status).toBe("needs_world_anchor");
        expect(brief.scenes[0]?.worldContext).toBeNull();
        expect(brief.warnings).toEqual(["Scene「神殿相遇」尚未设置完整 World Engine 时间范围。"]);
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_context：存在 unresolved subject 时阻断 handoff", async () => {
        const {service} = createService([createRecord()], {
            unresolvedSubjectIds: ["future-ally"],
        });

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterPath);

        expect(brief.status).toBe("needs_world_context");
        expect(brief.warnings).toEqual(["Scene「神殿相遇」存在未解析 subject：future-ally。"]);
        expect(brief.suggestedBriefMarkdown).toContain("future-ally");
    });
});

/**
 * 创建 service 与 mock 依赖。
 */
function createService(
    records: ChapterWriterBriefSceneWithThread[],
    contextPatch: Partial<SceneWorldContextDto> = {},
) {
    const sceneRepository = {
        findChapterScenesForBrief: vi.fn(async () => records),
    } as unknown as SceneRepository & {findChapterScenesForBrief: ReturnType<typeof vi.fn>};
    const scopeGuard = {
        assertChapterPath: vi.fn(async () => chapterPath),
    } as unknown as PlotScopeGuard & {assertChapterPath: ReturnType<typeof vi.fn>};
    const sceneWorldContextService = {
        getSceneWorldContextForScene: vi.fn(async () => createWorldContext(contextPatch)),
    } as unknown as SceneWorldContextService & {getSceneWorldContextForScene: ReturnType<typeof vi.fn>};
    const anchorResolutionService = {
        resolveMany: vi.fn(async (_projectPath: string, anchors: StorySceneWorldAnchorDto[]) => anchors.map(resolveAnchor)),
    } as unknown as SceneWorldAnchorResolutionService & {resolveMany: ReturnType<typeof vi.fn>};

    return {
        service: new ChapterWriterBriefService(
            sceneRepository,
            scopeGuard,
            sceneWorldContextService,
            anchorResolutionService,
            new PlotDtoAssembler(),
        ),
        sceneRepository,
        scopeGuard,
        sceneWorldContextService,
        anchorResolutionService,
    };
}

/**
 * 创建 brief read model 记录。
 */
function createRecord(patch: Partial<ChapterWriterBriefSceneWithThread> = {}): ChapterWriterBriefSceneWithThread {
    const base: ChapterWriterBriefSceneWithThread = {
        id: 10,
        storyId: 1,
        threadId: 2,
        chapterPath,
        threadSortOrder: 0,
        chapterSortOrder: 0,
        title: "神殿相遇",
        status: "draft",
        summary: "主角在神殿遇到未来盟友。",
        purpose: "建立同盟关系。",
        writingTip: "突出压迫感。",
        note: null,
        startInstant: 100n,
        endInstant: 200n,
        subjectIdsJson: JSON.stringify(["hero"]),
        locationSubjectId: "temple",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        thread: {
            id: 2,
            title: "主线",
            isMainThread: true,
            summary: "主线推进到神殿。",
            writingTip: "保持悬疑。",
        },
    };
    return {
        ...base,
        ...patch,
        thread: {
            ...base.thread,
            ...(patch.thread ?? {}),
        },
    };
}

/**
 * 创建 World Context fixture。
 */
function createWorldContext(patch: Partial<SceneWorldContextDto> = {}): SceneWorldContextDto {
    return {
        slices: [
            {
                id: "slice-1",
                time: "复兴纪元1日 00:02:00",
                title: "相关切面",
                summary: "神殿灯火变暗。",
                kind: "event",
                patchCount: 2,
            },
        ],
        subjectStates: [
            {
                subjectId: "hero",
                type: "character",
                name: "主角",
                attrs: {hp: 8},
            },
        ],
        unresolvedSubjectIds: [],
        ...patch,
    };
}

/**
 * 把 raw anchor fixture 解析成人类可读显示状态。
 */
function resolveAnchor(anchor: StorySceneWorldAnchorDto): StorySceneWorldAnchorDto {
    return {
        ...anchor,
        startTime: anchor.startInstant === null ? null : "复兴纪元1日 00:01:40",
        endTime: anchor.endInstant === null ? null : "复兴纪元1日 00:03:20",
        subjects: anchor.subjectIds.map((subjectId) => ({
            id: subjectId,
            name: subjectId === "hero" ? "主角" : subjectId,
            type: subjectId === "hero" ? "character" : "unknown",
            resolved: subjectId === "hero",
        })),
        locationSubject: anchor.locationSubjectId === null
            ? null
            : {
                id: anchor.locationSubjectId,
                name: "荒野神殿",
                type: "location",
                resolved: true,
            },
        unresolvedSubjectIds: anchor.subjectIds.filter((subjectId) => subjectId !== "hero"),
    };
}
