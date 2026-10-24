/**
 * 插件 SDK 的 `/storage`：内置插件 `nbook.storage` 的私有存储（docs/specs/storage/persistence.md）。入口依赖 `storageKey`，
 * 激活后 `open(defineRecord(…))` 拿到记录的句柄。服务端也加载。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {storageKey} from "nbook/plugins/storage/shared/contracts";
export {defineRecord} from "nbook/shared/storage";
export type {RecordDefinition, RecordHandle, RecordSnapshot, Revision, StorageFailure, StorageService, WriteResult} from "nbook/shared/storage";
