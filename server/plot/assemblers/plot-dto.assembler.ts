import type {
    Story,
    StoryPhase,
    StoryScene,
} from "nbook/server/generated/project-prisma/client";
import type {
    ChapterPlotSceneWithThread,
    StorySceneRefWithTargets,
    StorySceneWithDetails,
    StoryThreadEntity,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchScene,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterPlotDetailDto,
    ChapterPlotSceneDto,
    PlotTreeDto,
    PlotWorkbenchDto,
    StoryDto,
    StoryEffectiveRefDto,
    StoryPhaseDto,
    StoryRefDto,
    StorySceneDetailDto,
    StorySceneWorldAnchorDto,
    StorySceneSummaryDto,
    StoryWorkbenchPhaseDto,
    StoryWorkbenchSceneDto,
    StoryWorkbenchThreadDto,
    StoryThreadDetailDto,
    StoryThreadSummaryDto,
} from "nbook/shared/dto/plot.dto";
import {
    buildReferenceUri,
    parseStructuredReferenceTarget,
} from "nbook/shared/reference-core";

/**
 * 剧情 DTO 组装器。
 */
export class PlotDtoAssembler {

    /**
     * 映射 Story DTO。
     */
    toStoryDto(story: Story): StoryDto {
        return {
            id: stringifyEntityId(story.id),
            title: story.title,
            summary: story.summary,
            note: story.note,
            createdAt: story.createdAt.toISOString(),
            updatedAt: story.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 StoryPhase DTO。
     */
    toStoryPhaseDto(phase: StoryPhase): StoryPhaseDto {
        return {
            id: stringifyEntityId(phase.id),
            storyId: stringifyEntityId(phase.storyId),
            sortOrder: phase.sortOrder,
            name: phase.name,
            title: phase.title,
            summary: phase.summary,
            note: phase.note,
            createdAt: phase.createdAt.toISOString(),
            updatedAt: phase.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Thread 摘要 DTO。
     */
    toStoryThreadSummaryDto(thread: StoryThreadEntity): StoryThreadSummaryDto {
        return {
            id: stringifyEntityId(thread.id),
            storyId: stringifyEntityId(thread.storyId),
            storyPhaseId: thread.storyPhaseId === null ? null : stringifyEntityId(thread.storyPhaseId),
            sortOrder: thread.sortOrder,
            name: thread.name,
            title: thread.title,
            isMainThread: thread.isMainThread,
            status: thread.status,
            summary: thread.summary,
            tags: thread.tags,
            writingTip: thread.writingTip,
            note: thread.note,
            createdAt: thread.createdAt.toISOString(),
            updatedAt: thread.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Scene 摘要 DTO。
     */
    toStorySceneSummaryDto(scene: StoryScene): StorySceneSummaryDto {
        return {
            id: stringifyEntityId(scene.id),
            storyId: stringifyEntityId(scene.storyId),
            threadId: stringifyEntityId(scene.threadId),
            chapterPath: scene.chapterPath,
            threadSortOrder: scene.threadSortOrder,
            chapterSortOrder: scene.chapterSortOrder,
            title: scene.title,
            status: scene.status,
            summary: scene.summary,
            purpose: scene.purpose,
            writingTip: scene.writingTip,
            note: scene.note,
            worldAnchor: this.toStorySceneWorldAnchorDto(scene),
            createdAt: scene.createdAt.toISOString(),
            updatedAt: scene.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Scene World Anchor DTO。
     */
    toStorySceneWorldAnchorDto(scene: StoryScene): StorySceneWorldAnchorDto {
        const subjectIds = parseSubjectIdsJson(scene.subjectIdsJson);
        const locationSubjectId = scene.locationSubjectId;
        return {
            startTime: null,
            endTime: null,
            startInstant: scene.startInstant === null ? null : scene.startInstant.toString(),
            endInstant: scene.endInstant === null ? null : scene.endInstant.toString(),
            subjectIds,
            locationSubjectId,
            subjects: subjectIds.map(createUnresolvedAnchorSubject),
            locationSubject: locationSubjectId === null ? null : createUnresolvedAnchorSubject(locationSubjectId),
            unresolvedSubjectIds: uniqueSubjectIds([
                ...subjectIds,
                ...(locationSubjectId === null ? [] : [locationSubjectId]),
            ]),
        };
    }

    /**
     * 规范化 ref target。
     */
    normalizeStoryRefTarget(ref: StorySceneRefWithTargets): string {
        if (ref.targetKind === "content") {
            return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }

        if (ref.targetKind === "thread") {
            return ref.targetThread ? buildReferenceUri("thread", stringifyEntityId(ref.targetThread.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        if (ref.targetKind === "scene") {
            return ref.targetScene ? buildReferenceUri("scene", stringifyEntityId(ref.targetScene.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
    }

    /**
     * 映射 ref DTO。
     */
    toStoryRefDto(ref: StorySceneRefWithTargets): StoryRefDto {
        return {
            relation: ref.relation,
            target: this.normalizeStoryRefTarget(ref),
            visibility: ref.visibility,
            note: ref.note,
        };
    }

    /**
     * 组装 Scene 的有效 refs。
     */
    buildEffectiveSceneRefs(scene: StorySceneWithDetails): StoryEffectiveRefDto[] {
        return scene.refs.map((ref) => ({
            ...this.toStoryRefDto(ref),
            sourceType: "scene" as const,
            sourceId: stringifyEntityId(scene.id),
        }));
    }

    /**
     * 映射不含 refs 的 Thread 详情 DTO。
     */
    toStoryThreadDetailWithoutRefsDto(thread: StoryThreadWithScenes): StoryThreadDetailDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        };
    }

    /**
     * 映射 Scene 详情 DTO。
     */
    toStorySceneDetailDto(scene: StorySceneWithDetails): StorySceneDetailDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
            effectiveRefs: this.buildEffectiveSceneRefs(scene),
        };
    }

    /**
     * 映射章节剧情 Scene DTO。
     */
    toChapterPlotSceneDto(scene: ChapterPlotSceneWithThread): ChapterPlotSceneDto {
        return {
            id: stringifyEntityId(scene.id),
            threadId: stringifyEntityId(scene.thread.id),
            threadTitle: scene.thread.title,
            threadIsMain: scene.thread.isMainThread,
            chapterPath: scene.chapterPath,
            chapterSortOrder: scene.chapterSortOrder,
            threadSortOrder: scene.threadSortOrder,
            title: scene.title,
            status: scene.status,
            summary: scene.summary,
            purpose: scene.purpose,
            worldAnchor: this.toStorySceneWorldAnchorDto(scene),
        };
    }

    /**
     * 映射章节剧情详情 DTO。
     */
    toChapterPlotDetailDto(chapterPath: string, scenes: ChapterPlotSceneWithThread[]): ChapterPlotDetailDto {
        return {
            chapterPath,
            scenes: scenes.map((scene) => this.toChapterPlotSceneDto(scene)),
            totalScenes: scenes.length,
        };
    }

    /**
     * 映射 Workbench Scene DTO。
     */
    toStoryWorkbenchSceneDto(scene: StoryWorkbenchScene): StoryWorkbenchSceneDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
        };
    }

    /**
     * 映射 Workbench Thread DTO。
     */
    toStoryWorkbenchThreadDto(thread: StoryWorkbenchThread): StoryWorkbenchThreadDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStoryWorkbenchSceneDto(scene)),
        };
    }

    /**
     * 映射 Workbench Phase DTO。
     */
    toStoryWorkbenchPhaseDto(phase: StoryWorkbenchPhase): StoryWorkbenchPhaseDto {
        return {
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => this.toStoryWorkbenchThreadDto(thread)),
        };
    }

    /**
     * 组装剧情树 DTO。
     */
    toPlotTreeDto(input: {
        story: Story;
        phases: Array<StoryPhase & {threads: Array<StoryThreadEntity & {scenes: StoryScene[]}>}>;
        ungroupedThreads: Array<StoryThreadEntity & {scenes: StoryScene[]}>;
    }): PlotTreeDto {
        const phases = input.phases.map((phase) => ({
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => ({
                ...this.toStoryThreadSummaryDto(thread),
                scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
            })),
        }));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => ({
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        }));

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes: phases.reduce((sum, phase) => (
                sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
            ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0),
        };
    }

    /**
     * 组装剧本工作台 DTO。
     */
    toPlotWorkbenchDto(input: {
        story: Story;
        phases: StoryWorkbenchPhase[];
        ungroupedThreads: StoryWorkbenchThread[];
    }): PlotWorkbenchDto {
        const phases = input.phases.map((phase) => this.toStoryWorkbenchPhaseDto(phase));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => this.toStoryWorkbenchThreadDto(thread));
        const totalScenes = phases.reduce((sum, phase) => (
            sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
        ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0);

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes,
        };
    }
}

/**
 * 解析 Scene 出场 subject 列表。
 */
function parseSubjectIdsJson(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
    } catch {
        return [];
    }
}

/**
 * 生成尚未解析到 World Engine subject 的占位展示项。
 */
function createUnresolvedAnchorSubject(subjectId: string): StorySceneWorldAnchorDto["subjects"][number] {
    return {
        id: subjectId,
        name: subjectId,
        type: "unknown",
        resolved: false,
    };
}

/**
 * 保留顺序去重 subject id。
 */
function uniqueSubjectIds(subjectIds: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const subjectId of subjectIds) {
        const normalized = subjectId.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
