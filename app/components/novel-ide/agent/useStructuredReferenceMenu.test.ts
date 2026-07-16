import {describe, expect, it, vi} from "vitest";
import {nextTick, ref} from "vue";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";

const skillItems = [
    {
        name: "小说初始化流程",
        description: "初始化小说项目。",
        sourcePath: "assets/agent/skills/小说初始化流程/SKILL.md",
        metadata: {},
    },
    {
        name: "世界状态整理",
        description: "整理 World Engine 状态。",
        sourcePath: "assets/agent/skills/world-state/SKILL.md",
        metadata: {},
    },
    {
        key: "10-novel",
        name: "chapter-planner",
        description: "Split a chapter into actionable steps.",
        whenToUse: "Use for the tenth novel planning workflow.",
        searchText: "Deep body contains orbital palace and serialized outline contract.",
        source: "system",
        sourcePath: "assets/agent/skills/10-novel/SKILL.md",
        metadata: {},
    },
];

describe("useStructuredReferenceMenu", () => {
    it("coalesces concurrent skill catalog refreshes and updates the active menu", async () => {
        let resolveFetch: (items: typeof skillItems) => void = () => {};
        const fetchMock = vi.fn(() => new Promise<typeof skillItems>((resolve) => {
            resolveFetch = resolve;
        }));
        const previousFetch = globalThis.$fetch;
        globalThis.$fetch = fetchMock as unknown as typeof globalThis.$fetch;

        try {
            const menu = useStructuredReferenceMenu({
                novelId: ref("workspace/test"),
                selectedStoryThreadId: ref(null),
                selectedStorySceneId: ref(null),
                workspaceTree: ref([]),
            });

            const initialState = menu.resolveMenu({kind: "skill", query: "小说"});
            void menu.refreshSkillCatalog();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(initialState.sections[0]?.items[0]?.id).toBe("skill:loading");

            resolveFetch(skillItems);
            await Promise.resolve();
            await nextTick();

            const loadedState = menu.resolveMenu({kind: "skill", query: "小说"});

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(loadedState.sections[0]?.items[0]?.id).toBe("skill:小说初始化流程");

            await menu.refreshSkillCatalog();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.$fetch = previousFetch;
        }
    });

    it("skill 菜单支持多关键字匹配", async () => {
        const previousFetch = globalThis.$fetch;
        globalThis.$fetch = vi.fn(async () => skillItems) as unknown as typeof globalThis.$fetch;

        try {
            const menu = useStructuredReferenceMenu({
                novelId: ref("workspace/test"),
                selectedStoryThreadId: ref(null),
                selectedStorySceneId: ref(null),
                workspaceTree: ref([]),
            });

            await menu.refreshSkillCatalog();

            const state = menu.resolveMenu({kind: "skill", query: "小说 初始化"});

            expect(state.sections[0]?.items.map((item) => item.id)).toEqual(["skill:小说初始化流程"]);
        } finally {
            globalThis.$fetch = previousFetch;
        }
    });

    it("skill 菜单支持按 key 和路径任意字段匹配", async () => {
        const previousFetch = globalThis.$fetch;
        globalThis.$fetch = vi.fn(async () => skillItems) as unknown as typeof globalThis.$fetch;

        try {
            const menu = useStructuredReferenceMenu({
                novelId: ref("workspace/test"),
                selectedStoryThreadId: ref(null),
                selectedStorySceneId: ref(null),
                workspaceTree: ref([]),
            });

            await menu.refreshSkillCatalog();

            const numberState = menu.resolveMenu({kind: "skill", query: "10"});
            const dollarState = menu.resolveMenu({kind: "skill", query: "$10"});
            const yuanState = menu.resolveMenu({kind: "skill", query: "￥10"});
            const yenState = menu.resolveMenu({kind: "skill", query: "¥10"});
            const middleState = menu.resolveMenu({kind: "skill", query: "$novel"});

            expect(numberState.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
            expect(dollarState.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
            expect(yuanState.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
            expect(yenState.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
            expect(middleState.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
        } finally {
            globalThis.$fetch = previousFetch;
        }
    });

    it("skill 菜单支持匹配 SKILL.md 正文里的任意字符串", async () => {
        const previousFetch = globalThis.$fetch;
        globalThis.$fetch = vi.fn(async () => skillItems) as unknown as typeof globalThis.$fetch;

        try {
            const menu = useStructuredReferenceMenu({
                novelId: ref("workspace/test"),
                selectedStoryThreadId: ref(null),
                selectedStorySceneId: ref(null),
                workspaceTree: ref([]),
            });

            await menu.refreshSkillCatalog();

            const state = menu.resolveMenu({kind: "skill", query: "orbital palace"});

            expect(state.sections[0]?.items.map((item) => item.id)).toEqual(["skill:chapter-planner"]);
        } finally {
            globalThis.$fetch = previousFetch;
        }
    });
});
