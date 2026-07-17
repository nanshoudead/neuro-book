import {z} from "zod";
import {WorkflowRunListResponseDtoSchema} from "nbook/shared/dto/workflow.dto";
import {listWorkflowRuns} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const WorkflowRunListQuerySchema = z.object({
    projectPath: z.string().trim().min(1),
    workflowId: z.string().trim().min(1),
});

/**
 * 列出指定 workflow 的运行记录。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const query = WorkflowRunListQuerySchema.parse(getQuery(event));
    const result = await listWorkflowRuns(query.projectPath, query.workflowId);
    return WorkflowRunListResponseDtoSchema.parse(result);
}));
