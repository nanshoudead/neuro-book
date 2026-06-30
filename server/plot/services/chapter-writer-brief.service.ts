import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterWriterBriefDto,
    ChapterWriterBriefSceneDto,
    ChapterWriterBriefStatus,
    SceneWorldContextDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Chapter writer brief 只读聚合服务。
 */
export class ChapterWriterBriefService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly sceneWorldContextService: SceneWorldContextService,
        private readonly anchorResolutionService: SceneWorldAnchorResolutionService,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 生成指定章节的 writer brief DTO 与可直接交给 writer 的 markdown 草案。
     */
    async getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto> {
        const normalizedChapterPath = await this.scopeGuard.assertChapterPath(projectPath, chapterPath);
        const records = await this.sceneRepository.findChapterScenesForBrief(normalizedChapterPath);
        const scenes = await this.buildBriefScenes(projectPath, records);
        const warnings = uniqueStrings(scenes.flatMap((scene) => scene.warnings));
        const status = chooseStatus(scenes);
        if (records.length === 0) {
            warnings.push("本章节尚未关联 Plot Scene；请先让 director 建立章节 Scene 顺序。");
        }

        const brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown"> = {
            chapterPath: normalizedChapterPath,
            status,
            scenes,
            totalScenes: scenes.length,
            warnings,
        };
        return {
            ...brief,
            suggestedBriefMarkdown: renderSuggestedBriefMarkdown(brief),
        };
    }

    /**
     * 为每个 Scene 组装 brief scene item。
     */
    private async buildBriefScenes(
        projectPath: string,
        records: ChapterWriterBriefSceneWithThread[],
    ): Promise<ChapterWriterBriefSceneDto[]> {
        const rawAnchors = records.map((record) => this.assembler.toStorySceneWorldAnchorDto(record));
        const resolvedAnchors = await this.anchorResolutionService.resolveMany(projectPath, rawAnchors);
        const result: ChapterWriterBriefSceneDto[] = [];

        for (const [index, record] of records.entries()) {
            const worldAnchor = resolvedAnchors[index] ?? rawAnchors[index]!;
            const warnings: string[] = [];
            let worldContext: SceneWorldContextDto | null = null;

            if (record.startInstant === null || record.endInstant === null) {
                warnings.push(`Scene「${record.title}」尚未设置完整 World Engine 时间范围。`);
            } else {
                worldContext = await this.readWorldContext(projectPath, record, warnings);
                if (worldContext && worldContext.unresolvedSubjectIds.length > 0) {
                    warnings.push(`Scene「${record.title}」存在未解析 subject：${worldContext.unresolvedSubjectIds.join(", ")}。`);
                }
                if (worldContext && worldContext.slices.length === 0 && worldContext.subjectStates.length === 0 && worldContext.unresolvedSubjectIds.length === 0) {
                    warnings.push(`Scene「${record.title}」没有可展示的 World Engine 上下文；可继续写作，但建议 director 复核是否需要补状态。`);
                }
            }

            result.push({
                id: stringifyEntityId(record.id),
                threadId: stringifyEntityId(record.thread.id),
                threadTitle: record.thread.title,
                threadIsMain: record.thread.isMainThread,
                threadSummary: record.thread.summary,
                threadWritingTip: record.thread.writingTip,
                chapterPath: record.chapterPath,
                chapterSortOrder: record.chapterSortOrder,
                threadSortOrder: record.threadSortOrder,
                title: record.title,
                status: record.status,
                summary: record.summary,
                purpose: record.purpose,
                writingTip: record.writingTip,
                worldAnchor,
                worldContext,
                warnings,
            });
        }

        return result;
    }

    /**
     * 读取单个 Scene 的 World Engine 上下文，失败时只记录通用 warning。
     */
    private async readWorldContext(
        projectPath: string,
        record: ChapterWriterBriefSceneWithThread,
        warnings: string[],
    ): Promise<SceneWorldContextDto | null> {
        try {
            return await this.sceneWorldContextService.getSceneWorldContextForScene(projectPath, record);
        } catch {
            warnings.push(`Scene「${record.title}」的 World Engine 上下文查询失败；请先让 leader 或 world.engine 复核世界状态。`);
            return null;
        }
    }
}

/**
 * 按固定优先级聚合 brief 状态。
 */
function chooseStatus(scenes: ChapterWriterBriefSceneDto[]): ChapterWriterBriefStatus {
    if (scenes.length === 0) {
        return "needs_plot";
    }
    if (scenes.some((scene) => scene.worldAnchor.startInstant === null || scene.worldAnchor.endInstant === null)) {
        return "needs_world_anchor";
    }
    if (scenes.some((scene) => scene.worldContext === null || scene.worldContext.unresolvedSubjectIds.length > 0)) {
        return "needs_world_context";
    }
    return "ready";
}

/**
 * 渲染可直接作为 writer message 草案的 markdown。
 */
function renderSuggestedBriefMarkdown(brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown">): string {
    const lines: string[] = [
        "# Chapter Writer Brief",
        "",
        `Chapter: ${brief.chapterPath}`,
        `Status: ${brief.status}`,
        "",
    ];

    if (brief.warnings.length > 0) {
        lines.push("## Warnings", ...brief.warnings.map((warning) => `- ${warning}`), "");
    }

    if (brief.scenes.length === 0) {
        lines.push("## Scenes", "- 本章节尚未关联 Plot Scene。", "");
        return lines.join("\n").trimEnd();
    }

    lines.push("## Scenes");
    for (const [index, scene] of brief.scenes.entries()) {
        lines.push(
            "",
            `### ${index + 1}. ${scene.title}`,
            `- Thread: ${scene.threadTitle}${scene.threadIsMain ? "（主线）" : ""}`,
            `- Scene status: ${scene.status}`,
            `- Time: ${formatRange(scene.worldAnchor.startTime ?? scene.worldAnchor.startInstant, scene.worldAnchor.endTime ?? scene.worldAnchor.endInstant)}`,
            `- Subjects: ${formatSubjects(scene.worldAnchor.subjects)}`,
            `- Location: ${scene.worldAnchor.locationSubject?.name ?? "未指定"}`,
            `- Scene summary: ${scene.summary || "未填写"}`,
            `- Scene purpose: ${scene.purpose ?? "未填写"}`,
            `- Scene writing tip: ${scene.writingTip ?? "未填写"}`,
            `- Thread summary: ${scene.threadSummary || "未填写"}`,
            `- Thread writing tip: ${scene.threadWritingTip ?? "未填写"}`,
        );
        appendWorldContext(lines, scene.worldContext);
    }

    return lines.join("\n").trimEnd();
}

/**
 * 渲染简短 World Engine 上下文，避免输出 raw attrs 或 patch JSON。
 */
function appendWorldContext(lines: string[], context: SceneWorldContextDto | null): void {
    if (!context) {
        lines.push("- World context: 暂不可用");
        return;
    }

    if (context.slices.length === 0) {
        lines.push("- World slices: 无匹配切面");
    } else {
        lines.push("- World slices:");
        for (const slice of context.slices) {
            lines.push(`  - ${slice.time} ${slice.title}: ${slice.summary || "无摘要"}（相关 patches: ${slice.patchCount}）`);
        }
    }

    if (context.subjectStates.length === 0) {
        lines.push("- Subject states: 无可展示终态");
    } else {
        lines.push(`- Subject states: ${context.subjectStates.map((subject) => `${subject.name}(${subject.type})`).join(", ")}`);
    }
}

/**
 * 格式化时间范围。
 */
function formatRange(start: string | null, end: string | null): string {
    if (!start || !end) {
        return "未连接";
    }
    return `${start} ~ ${end}`;
}

/**
 * 格式化 Scene subjects。
 */
function formatSubjects(subjects: ChapterWriterBriefSceneDto["worldAnchor"]["subjects"]): string {
    if (subjects.length === 0) {
        return "未指定";
    }
    return subjects.map((subject) => subject.resolved ? subject.name : `${subject.id}（未解析）`).join(", ");
}

/**
 * 保留顺序去重字符串。
 */
function uniqueStrings(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
