import {readProjectRagInspector} from "nbook/server/rag/project-rag-visualization";
import {ProjectRagInspectorDtoSchema, ProjectRagInspectorRequestDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";

/**
 * 读取 Project RAG Inspector 的索引与向量元数据快照。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const sources = typeof query.sources === "string"
        ? query.sources.split(",").map((item) => item.trim()).filter(Boolean)
        : undefined;
    const limit = typeof query.limit === "string" && query.limit.trim()
        ? Number(query.limit)
        : undefined;
    const input = ProjectRagInspectorRequestDtoSchema.parse({
        subjectPath: typeof query.subjectPath === "string" && query.subjectPath.trim() ? query.subjectPath.trim() : undefined,
        sources,
        limit,
    });
    const result = await readProjectRagInspector(requireProjectPathQuery(event), input);
    return ProjectRagInspectorDtoSchema.parse(result);
});
