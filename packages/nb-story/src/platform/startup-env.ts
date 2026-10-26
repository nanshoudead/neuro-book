/**
 * 进程启动时的环境变量快照：nbstory 判断“密钥有没有设置”、取密钥值都只认它（docs/adr/0032）。
 *
 * 为什么要快照：OMP 一被导入就把家目录、OMP 配置目录与 agent 目录里的 `.env` 并进 `process.env`。`ask`、`serve`、
 * `config` 会导入 OMP，`ingest` 不导入，同一个变量在两边的“有没有值”就不一样。快照在 `cli/main.ts` 的第一条导入里取，
 * 先于任何 OMP 模块，所以只含 shell 导出的变量，加上 Bun 自己在运行用户代码之前加载的当前目录 `.env`（那是 Bun 的行为，
 * 不由这里控制）。
 *
 * 它不挡 OMP 自己取值：目录服务商的密钥仍由 OMP 的规则选（可能认它自己的 `.env`），这里只在“启动环境里一个相关变量
 * 都没有”时拒绝，见 `startupKeyReady`。
 */

export const startupEnv: Readonly<Record<string, string | undefined>> = Object.freeze({...process.env});

/** 启动环境里这个变量有非空的值。 */
export const startupHas = (name: string): boolean => (startupEnv[name] ?? "").trim() !== "";

/** 一组可选的密钥变量里，启动环境至少有一个有值；一个都不需要（空表，例如本机服务）也算好了。 */
export const startupKeyReady = (names: readonly string[]): boolean => names.length === 0 || names.some(startupHas);
