/**
 * runtime.plugin-manifest：插件目录的 `package.json` 清单与代码定义之间的互相转换。
 *
 * - 清单格式按平台档案建（`createManifestFormat`）：引擎键与保留的发布者由宿主给出，内核不写任何应用的名字。
 * - 读：结构与字符串规则校验后规范成 `PluginManifest`（`read.ts`），不碰文件系统。
 * - 生成：代码定义写成清单并立刻读一遍（`build.ts`）。内置插件不写清单文件，它的代码定义就是清单；应用侧的对齐测试
 *   把代码定义生成清单，再还原比对。
 * - 还原：清单转成插件描述与各运行位置的定义（`definition.ts`）。
 *
 * 版本与版本范围按 npm semver 的写法，校验由调用方经 `versions` 给出：内核的运行时依赖只有 TypeBox，而手写的近似语法
 * 会放过非法写法、拒绝合法写法。
 *
 * 贡献点与激活事件前缀按插件声明。第三方插件的定义在它有入口的每个运行位置都带上它们；内置插件的代码定义可以只在
 * 部分位置定义（例如校验函数只在那里用得到），对齐测试按插件汇总比较。
 *
 * 行为合同见 docs/specs/runtime/plugin-manifest.md。
 */

export type {ManifestBuildResult, ManifestSource} from "./build";
export {definitionOf, descriptorOf} from "./definition";
export type {DefinitionOptions} from "./definition";
export {createManifestFormat} from "./format";
export type {ManifestFormat, ManifestFormatOptions} from "./format";
export {isBuiltinId, isReservedPublisher, RUNTIME_PUBLISHER} from "../plugins/plugins";
export type {PluginPlatform} from "../plugins/plugins";
export {ID_SEGMENT_RULE, isIdSegment, isPluginId} from "./schema";
export type {
    ManifestContract,
    ManifestContribution,
    ManifestContributionPoint,
    ManifestEntry,
    ManifestProblem,
    ManifestReadResult,
    PluginManifest,
    VersionSyntax,
} from "./schema";
