import {WorkflowRunDtoSchema, WorkflowRunRecordRequestDtoSchema} from "nbook/shared/dto/workflow.dto";
import {recordWorkflowRun} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 记录 workflow run 的 Agent 执行详情、工具调用和文件 diff 提案。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const body = WorkflowRunRecordRequestDtoSchema.parse(await readBody(event));
    const result = await recordWorkflowRun(body);
    return WorkflowRunDtoSchema.parse(result);
}));
