import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {createDefaultWorkflow, listProjectWorkflows, listWorkflowRuns, startWorkflowRun, updateWorkflowRunStep} from "nbook/server/workflow/workflow-service";
import {withIsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

describe("workflow-service", () => {
    it("安装默认 workflow 并推进一次 run", async () => {
        await withIsolatedWorkspaceAssets({}, async (assets) => {
            const projectPath = "workspace/workflow-test";
            const projectRoot = path.join(assets.workspaceContainerRoot, "workflow-test");
            await fs.mkdir(projectRoot, {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Workflow Test\nsummary: ''\n", "utf-8");
            await openProjectForTest(projectPath);
            try {
                const definition = await createDefaultWorkflow(projectPath);
                expect(definition.id).toBe("chapter-draft");

                const workflows = await listProjectWorkflows(projectPath);
                expect(workflows.workflows).toHaveLength(1);
                expect(workflows.workflows[0]).toMatchObject({
                    id: "chapter-draft",
                    title: "Writing Run",
                    stepCount: 1,
                });

                const run = await startWorkflowRun(projectPath, "chapter-draft");
                expect(run.steps[0]).toMatchObject({
                    stepId: "run",
                    title: "Writing Run",
                    status: "active",
                });

                const afterComplete = await updateWorkflowRunStep({
                    projectPath,
                    workflowId: "chapter-draft",
                    runId: run.id,
                    stepId: "run",
                    action: "complete",
                    note: "运行完成",
                });
                expect(afterComplete.steps[0]).toMatchObject({
                    status: "completed",
                    note: "运行完成",
                });

                const runs = await listWorkflowRuns(projectPath, "chapter-draft");
                expect(runs.runs[0]?.id).toBe(run.id);
            } finally {
                await closeProjectForTest(projectPath);
            }
        });
    });
});
