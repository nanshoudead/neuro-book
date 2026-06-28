import {profileText} from "nbook/server/agent/profiles/profile-text";
import type {ExecuteWorldMode} from "nbook/server/world-engine/world-engine.facade";

/** 构造 execute_world 在不同 profile 权限下暴露给模型的工具说明。 */
export function buildExecuteWorldDescription(mode: ExecuteWorldMode): string {
    const writeApi = mode === "readwrite"
        ? profileText`
            Write API is also available:

            \`\`\`typescript
            world.slice.write({
                time: bigint,
                title?: string,
                summary?: string,
                kind?: string,
                patches: Array<{
                    subjectId: string,
                    path: string,
                    op: "replace" | "increment" | "remove" | "append",
                    value?: unknown,
                    summary?: string,
                    type?: string,
                    name?: string,
                }>,
            }): Promise<{sliceId: string; issues: WorldIssue[]}>;

            world.slice.editPatches(
                sliceId: string,
                edits: Array<
                    | {patchId: string, set: {path?: string, op?: string, value?: unknown, summary?: string}}
                    | {patchId: string, remove: true}
                    | {add: {subjectId: string, path: string, op: string, value?: unknown, summary?: string}}
                >,
                meta?: {time?: bigint, title?: string, summary?: string, kind?: string},
            ): Promise<{sliceId: string; issues: WorldIssue[]}>;

            world.slice.delete(sliceId: string): Promise<{issues: WorldIssue[]}>;
            \`\`\`

            Writing rules:
            - Write time is an instant bigint. Use world.time.parse("项目日历字符串") before writing and world.time.format(instant) when returning human-readable summaries.
            - Use JSON Pointer paths everywhere, such as /hp or /memory/师门.
            - Do not catch and swallow write errors. If issues prove the write should not commit, throw to roll back the whole script.
            - Do not return issues yourself; the tool result always includes collector issues as {data, issues}.
            - To fix a wrong patch in an existing slice, read patchId via world.slice.get(sliceId) or world.slice.list({withPatches:true}), then use world.slice.editPatches. Do not delete and rewrite a whole slice just to fix one patch.
        `
        : profileText`
            This profile has readonly World Engine access. world.slice.write, world.slice.editPatches, and world.slice.delete are not available.
        `;

    return profileText`
        Execute JavaScript code against the current Project Workspace World Engine.

        The tool always returns:

        \`\`\`typescript
        { data: unknown, issues: WorldIssue[] }
        \`\`\`

        Read API:

        \`\`\`typescript
        world.time.parse(calendarText: string): bigint;
        world.time.format(instant: bigint): string;
        world.time.now(): bigint;

        world.subject.get(id: string, options?: {deref?: boolean, derefDepth?: number}): Promise<any | null>;
        world.subject.gets(ids: string[]): Promise<Array<any | null>>;
        world.subject.list(type?: string): Promise<Array<{id: string, type: string, name: string}>>;
        world.subject.findRefs(targetId: string, sourceType?: string): Promise<Array<{subjectId: string, attr: string}>>;

        world.search.text(query: string, options?: {k?: number, threshold?: number, types?: string[], attrs?: string[], at?: bigint}): Promise<Array<{subjectId: string, attr: string, text: string, score: number}>>;

        world.slice.list(options?: {from?: bigint, to?: bigint, limit?: number, withPatches?: boolean}): Promise<any[]>;
        world.slice.get(sliceId: string): Promise<{id: string, instant: bigint, title: string, summary: string, kind: string, patches: Array<{patchId: string, subjectId: string, path: string, op: string, value?: unknown, summary?: string}>}>;
        \`\`\`

        ${writeApi}

        Constraints:
        - Code must be inline in the code argument.
        - Use await for async world.subject.* / world.search.* / world.slice.* methods.
        - Result data is limited to 10KB; return summaries or selected fields, not full world dumps.
        - BigInt values are serialized as strings in the final tool details.
    `;
}
