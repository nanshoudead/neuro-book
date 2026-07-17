import {WorkflowListResponseDtoSchema} from "nbook/shared/dto/workflow.dto";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {listProjectWorkflows} from "nbook/server/workflow/workflow-service";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 列出当前 Project Workspace 的 workflow 定义。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const result = await listProjectWorkflows(requireProjectPathQuery(event));
    return WorkflowListResponseDtoSchema.parse(result);
}));
