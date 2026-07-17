import {WorkflowCreateDefaultRequestDtoSchema, WorkflowDefinitionDtoSchema} from "nbook/shared/dto/workflow.dto";
import {createDefaultWorkflow} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 安装内置章节写作 workflow。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const body = WorkflowCreateDefaultRequestDtoSchema.parse(await readBody(event));
    const result = await createDefaultWorkflow(body.projectPath);
    return WorkflowDefinitionDtoSchema.parse(result);
}));
