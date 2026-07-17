import {WorkflowRunDtoSchema, WorkflowStepActionRequestDtoSchema} from "nbook/shared/dto/workflow.dto";
import {updateWorkflowRunStep} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 更新 workflow run 中的单个步骤状态。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const body = WorkflowStepActionRequestDtoSchema.parse(await readBody(event));
    const result = await updateWorkflowRunStep(body);
    return WorkflowRunDtoSchema.parse(result);
}));
