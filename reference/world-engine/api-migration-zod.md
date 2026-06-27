# World Engine API 迁移速查：Zod Schema + 当前工具

本文只给 Agent 快速校准当前协议。完整概念见同目录 `schema-system.md`、`subject-lifecycle.md`、`workflow.md`。

## 当前真相源

- Schema 文件：`world-engine/schema/index.ts`，使用 TypeScript + Zod。
- Calendar 文件：`world-engine/calendar.ts`。
- Agent 写作模式工具：
  - `execute_world_query`：只读查询，在 CodeAct 沙盒中使用 `world` API。
  - `write_world_slice`：写入一个时间点的切面，字段为 `time` + `title` + `patches`。
  - `delete_world_slice`：删除误写切面，先用 `world.slices()` 取得 `sliceId`。

## 旧协议对照

| 旧说法 | 当前做法 |
| --- | --- |
| `schema.yaml` | `world-engine/schema/index.ts` |
| `create_world_subject` | 首次 `write_world_slice` 时在任意 patch 上声明 `type`，自动创建 subject |
| `get_world_state` / `list_world_slices` | `execute_world_query` 中使用 `world.get` / `world.getMany` / `world.list` / `world.slices` |
| `mutations` | `patches` |
| `attr` | JSON Pointer `path`，如 `/hp`、`/equipment/weapon` |
| `set` / `add` / `listAppend` | `replace` / `increment` / `append` |

## 最小写入示例

```javascript
write_world_slice(projectPath, {
    time: "星辉历312年 春之月5日 10:30",
    title: "艾莉娜登场",
    patches: [
        {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
        {subjectId: "erina", path: "/events", op: "append", value: "在无名祭坛醒来"}
    ]
});
```

## 查询示例

```javascript
const erina = await world.get("erina");
const party = await world.getMany(["erina", "liya"]);
const characters = await world.list("character");
const recentSlices = await world.slices({limit: 10});
```

## 提醒

- 时间只传项目日历字符串，不传 raw instant。
- 写入前先查已有 subject 和目标时间附近的 slice。
- E issues 必须修；A issues 只需确认语义。
- 用户不需要理解 schema、slice、patch、op；对用户汇报用时间线和当前状态摘要。
