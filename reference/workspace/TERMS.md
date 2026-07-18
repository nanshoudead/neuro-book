# Workspace Terms

本文件定义 NeuroBook 中 workspace 相关术语。后续文档、代码注释、API 命名和设置页文案都应优先引用这些词，避免把 `workspace` 同时用于多个层级。

## Terms

- **Installation Root**：NeuroBook 源码与 `.output`、`.runtime`、`.deploy` 组件的统一程序根；它不是 Workspace Root。
- **State Root**：运行状态的物理根。默认等于 Installation Root；Windows Portable 为 `Installation Root/data/`。
- **Workspace Root**：应用运行数据根目录，默认是 `workspace/`。它只是数据容器，不直接表示某本小说或某个项目。
- **Workspace Root `.nbook`**：Workspace Root 的全局控制区，默认是 `workspace/.nbook/`。它保存 Global Config、用户 assets、全局 Agent 资源覆盖层和后续全局运行状态。
- **Project Workspace**：一个具体内容项目的工作区，当前主要是单本小说，默认是 `workspace/{project}/`。它保存 manuscript、lorebook 等项目内容。
- **Project Slug**：Project Workspace 在 Workspace Root 下的单段目录名，例如 `ming-ding-zhi-shi-2`。
- **Project Path**：项目级 API 使用的稳定标识，形态固定为 `workspace/{project-slug}`；它不是文件工具的 cwd-relative 路径。
- **Agent Workspace Root Reference**：Agent session中持久化的逻辑工作区引用。managed值只使用`workspace`或`workspace/.nbook`；外部Project Workspace可以使用用户明确给出的绝对路径。
- **Agent Workspace Filesystem Root**：每次Agent invocation按当前State Root解析出的绝对文件系统根。它只用于运行时文件访问，不写入managed session元数据。
- **File Scope**：文件工具与 bash 在一次 Agent invocation 中共用的物理 cwd。绑定 Project Path 时是当前 Project Workspace；未绑定项目时是 Workspace Root；user-assets 时是 Workspace Root `.nbook`；外部 Project Workspace 时是其绝对目录。
- **Project File Address**：显式跨项目文件地址，形态为 `workspace/{project-slug}/{relative-path}`。它由 Project Path Resolver 解析，不是通过 cwd 字符串剥离得到的 alias。
- **Project Workspace `.nbook`**：Project Workspace 的项目级控制区，默认是 `workspace/{project}/.nbook/`。它保存 Project Config、项目状态和项目私有元数据。
- **Project Runtime Artifact**：NeuroBook 从 Project Workspace 源文件派生、可随时重建、仅供运行时执行或缓存使用的文件。canonical 位置在 Project Workspace `.nbook`；它不是项目内容，不进入文件历史、Agent 文件变更提醒、Project Workspace File Index 或 Project 下载包。
- **Project Workspace Download Archive**：Project Workspace 的可携带完整备份。普通文件继续遵守 `.gitignore`，`project.yaml`、Project Config、Project SQLite 和已有 History SQLite 强制纳入；两个 SQLite 使用独立在线 snapshot，不复制 live WAL/SHM。History SQLite 可能包含全文、删除内容、acceptance 与 session cursor，分享前必须评估隐私风险。
- **user-assets**：前端用于编辑 Workspace Root `.nbook` 的入口。它不是独立配置层，而是把当前 Studio 挂载在 `workspace/.nbook/`。
- **Bundled Workspace Template**：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。

## Path Mapping

- `assets/workspace/.nbook` 是系统模板层，映射到运行时 `workspace/.nbook`。
- `NEURO_BOOK_STATE_ROOT` 决定 State Root；Workspace Root、Boot Config、Product Env 和日志都从 State Root 解析。
- Windows Portable 的物理 Workspace Root 是 `data/workspace/`，但 Project Path 仍固定为 `workspace/{project-slug}`。
- 用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`。
- `assets/workspace/global.config.example.json` 对应运行时 `workspace/.nbook/config.json` 的示例。
- `assets/workspace/workspace.config.example.json` 对应运行时 `workspace/{project}/.nbook/config.json` 的示例。
- user-assets 入口直接编辑 `workspace/.nbook`，不再使用 `workspace/.nbook/assets` 作为嵌套资产根。
- Project-bound Agent 的 File Scope 是当前 Project Workspace。当前项目使用 `manuscript/...`、`lorebook/...`、`reference/...`；跨项目使用完整 Project File Address `workspace/{project-slug}/...`。
- Project Runtime Artifact 固定写入 Project Workspace `.nbook` 控制区；源码目录旁的旧 runtime artifact 位置只用于迁移清理，不再作为当前写入位置。
- Project Workspace Download Archive 在 OS 临时目录准备 SQLite snapshot，不向 Project Workspace 写入打包中转文件；Project SQLite 与 History SQLite 分别一致，但不承诺与普通文件构成跨存储全局事务。
- Agent session保存Agent Workspace Root Reference和Project Path；每次invocation据此投影File Scope，不持久化managed绝对cwd。Windows Portable中当前Project因此解析到`data/workspace/{project-slug}/`。
- Current Project Workspace决定Project-bound invocation的File Scope；它不是权限边界，跨项目访问必须使用显式Project File Address。
- 仓库源码根与仓库级 `reference/` 位于Project File Scope外，使用runtime reminder提供的绝对路径访问。

## Naming Rules

- 不要把 Workspace Root 缩写成 workspace 来表达 Project Workspace。
- 不要把 Project Workspace 缩写成 workspace。
- 不要把 **Installation Root** 或 **State Root** 称为 Workspace Root；前者是程序组件根，后者是状态物理根，Workspace Root 是项目数据容器。
- 当讨论单本小说/项目的文件根时，使用 **Project Workspace**。
- 当讨论全局用户资产、全局配置、Agent profiles/skills 覆盖层时，使用 **Workspace Root `.nbook`**。
- 当讨论前端入口时，`user-assets` 只表示 Studio 挂载目标，不表示新的配置 scope。
