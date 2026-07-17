import {z} from "zod";

export const WorkflowStepKindDtoSchema = z.literal("manual");

export const WorkflowStepDtoSchema = z.object({
    id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/u),
    title: z.string().trim().min(1).max(120),
    kind: WorkflowStepKindDtoSchema.default("manual"),
    description: z.string().trim().max(2000).optional().default(""),
    prompt: z.string().trim().max(4000).optional().default(""),
});

export const WorkflowDefinitionDtoSchema = z.object({
    id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/u),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional().default(""),
    version: z.number().int().min(1).optional().default(1),
    steps: z.array(WorkflowStepDtoSchema).min(1).max(40),
}).superRefine((definition, ctx) => {
    const seen = new Set<string>();
    for (const step of definition.steps) {
        if (seen.has(step.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["steps"],
                message: `Workflow step id duplicated: ${step.id}`,
            });
        }
        seen.add(step.id);
    }
});

export const WorkflowRunStepStatusDtoSchema = z.enum(["pending", "active", "completed", "skipped", "failed"]);
export const WorkflowRunStatusDtoSchema = z.enum(["active", "completed", "failed"]);

export const WorkflowRunStepDtoSchema = z.object({
    stepId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional().default(""),
    description: z.string().optional().default(""),
    prompt: z.string().optional().default(""),
    status: WorkflowRunStepStatusDtoSchema,
    note: z.string().optional().default(""),
    startedAt: z.string().nullable().optional().default(null),
    completedAt: z.string().nullable().optional().default(null),
});

export const WorkflowRunToolCallDtoSchema = z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    status: z.enum(["streaming", "invalid", "running", "success", "error"]),
    path: z.string().optional().default(""),
    summary: z.string().optional().default(""),
    argsPreview: z.string().optional().default(""),
    resultPreview: z.string().optional().default(""),
    updatedAt: z.string(),
});

export const WorkflowRunFileProposalStatusDtoSchema = z.enum(["pending", "accepted", "rejected"]);

export const WorkflowRunFileProposalDtoSchema = z.object({
    id: z.string().trim().min(1),
    path: z.string().trim().min(1),
    title: z.string().optional().default(""),
    baseContent: z.string(),
    incomingContent: z.string(),
    status: WorkflowRunFileProposalStatusDtoSchema.optional().default("pending"),
    createdAt: z.string(),
    resolvedAt: z.string().nullable().optional().default(null),
});

export const WorkflowRunDtoSchema = z.object({
    id: z.string().trim().min(1),
    workflowId: z.string().trim().min(1),
    projectPath: z.string().trim().min(1),
    status: WorkflowRunStatusDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    steps: z.array(WorkflowRunStepDtoSchema),
    agentSessionId: z.number().int().positive().nullable().optional().default(null),
    targetFilePath: z.string().optional().default(""),
    targetFileTitle: z.string().optional().default(""),
    goal: z.string().optional().default(""),
    baselineContent: z.string().nullable().optional().default(null),
    agentStartedAt: z.string().nullable().optional().default(null),
    agentCompletedAt: z.string().nullable().optional().default(null),
    toolCalls: z.array(WorkflowRunToolCallDtoSchema).optional().default([]),
    fileProposals: z.array(WorkflowRunFileProposalDtoSchema).optional().default([]),
});

export const WorkflowSummaryDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    version: z.number().int().min(1),
    stepCount: z.number().int().min(0),
    updatedAt: z.string().nullable(),
});

export const WorkflowListResponseDtoSchema = z.object({
    projectPath: z.string(),
    workflows: z.array(WorkflowSummaryDtoSchema),
});

export const WorkflowRunListResponseDtoSchema = z.object({
    projectPath: z.string(),
    workflowId: z.string(),
    runs: z.array(WorkflowRunDtoSchema),
});

export const WorkflowCreateDefaultRequestDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
});

export const WorkflowRunCreateRequestDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    workflowId: z.string().trim().min(1),
});

export const WorkflowStepActionRequestDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    workflowId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    stepId: z.string().trim().min(1),
    action: z.enum(["complete", "skip", "reopen"]),
    note: z.string().max(2000).optional().default(""),
});

export const WorkflowRunRecordRequestDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    workflowId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    agentSessionId: z.number().int().positive().nullable().optional(),
    targetFilePath: z.string().optional(),
    targetFileTitle: z.string().optional(),
    goal: z.string().optional(),
    baselineContent: z.string().nullable().optional(),
    agentStartedAt: z.string().nullable().optional(),
    agentCompletedAt: z.string().nullable().optional(),
    toolCalls: z.array(WorkflowRunToolCallDtoSchema).optional(),
    fileProposal: WorkflowRunFileProposalDtoSchema.optional(),
    resolveFileProposal: z.object({
        id: z.string().trim().min(1),
        status: WorkflowRunFileProposalStatusDtoSchema,
        resolvedAt: z.string(),
    }).optional(),
});

export type WorkflowStepDto = z.infer<typeof WorkflowStepDtoSchema>;
export type WorkflowDefinitionDto = z.infer<typeof WorkflowDefinitionDtoSchema>;
export type WorkflowRunStepStatusDto = z.infer<typeof WorkflowRunStepStatusDtoSchema>;
export type WorkflowRunStatusDto = z.infer<typeof WorkflowRunStatusDtoSchema>;
export type WorkflowRunStepDto = z.infer<typeof WorkflowRunStepDtoSchema>;
export type WorkflowRunToolCallDto = z.infer<typeof WorkflowRunToolCallDtoSchema>;
export type WorkflowRunFileProposalStatusDto = z.infer<typeof WorkflowRunFileProposalStatusDtoSchema>;
export type WorkflowRunFileProposalDto = z.infer<typeof WorkflowRunFileProposalDtoSchema>;
export type WorkflowRunDto = z.infer<typeof WorkflowRunDtoSchema>;
export type WorkflowSummaryDto = z.infer<typeof WorkflowSummaryDtoSchema>;
export type WorkflowListResponseDto = z.infer<typeof WorkflowListResponseDtoSchema>;
export type WorkflowRunListResponseDto = z.infer<typeof WorkflowRunListResponseDtoSchema>;
export type WorkflowRunRecordRequestDto = z.infer<typeof WorkflowRunRecordRequestDtoSchema>;
