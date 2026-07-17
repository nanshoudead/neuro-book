import {WorkflowRunCreateRequestDtoSchema, WorkflowRunDtoSchema} from "nbook/shared/dto/workflow.dto";
import {startWorkflowRun} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 启动一次 workflow run。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const body = WorkflowRunCreateRequestDtoSchema.parse(await readBody(event));
    const result = await startWorkflowRun(body.projectPath, body.workflowId);
    return WorkflowRunDtoSchema.parse(result);
}));
