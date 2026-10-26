/**
 * 插件 SDK 的 `/state`：内置插件 `nbook.state` 的插件状态与公开状态（docs/specs/state/store.md、docs/specs/state/public-state.md）。
 * 服务端也加载。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {defineStore} from "nbook/shared/store/store";
export {definePublicState} from "nbook/shared/store/public";
