import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";

/** 世界引擎单例门面。 */
export const worldEngineFacade = new WorldEngineFacade();

export {WorldEngineFacade};
export type {
    Instant,
    JsonValue,
    CreateWorldSubjectResult,
    DeleteSliceResult,
    MutationInput,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    SubjectState,
    WorldIssue,
    WorldIssueCode,
    WorldMutationOp,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";
