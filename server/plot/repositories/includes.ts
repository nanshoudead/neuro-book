/**
 * Scene refs 详情 include。
 */
export const STORY_SCENE_REF_INCLUDE = {
    targetThread: {
        select: {
            id: true,
            name: true,
        },
    },
    targetScene: {
        select: {
            id: true,
        },
    },
} as const;
