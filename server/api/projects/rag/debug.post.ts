import {debugProjectRag} from "nbook/server/rag/project-rag-visualization";
import {ProjectRagDebugRequestDtoSchema, ProjectRagDebugResultDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 执行 RAG Inspector 调试操作。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagDebugRequestDtoSchema);
    const result = await debugProjectRag(requireProjectPathQuery(event), body);
    return ProjectRagDebugResultDtoSchema.parse(result);
});
