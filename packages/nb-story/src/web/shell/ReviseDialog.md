---
标签: ["state:inject", "io:read", "io:mutate", "env:portal"]
---

# 修订对话框

人物卡“⋯”菜单打开的三个对话框（docs/specs/story/viewer.md 输出 60）：连到另一个对象、改对象种类、某个称呼属于别的对象。三个都要选一句依据（默认列这个对象在已读章里出现的段，也可以直接写“章.段”），写明“修订从这一段起生效，读到它之前看不到”，底部列“改完会怎样”。失败（目标不存在、没有意义的改动）在对话框里写出原因，不关闭。

## 数据

```ts
defineProps<{
    open: boolean;
    mode: "link" | "kind" | "name";
    /** 人物卡的对象编号、显示名与现在的种类、称呼表。必填。 */
    entity: string;
    label: string;
    kind: EntityKind;
    names: string[];
}>();
defineEmits<{"update:open": [value: boolean]}>();
```

## 隐藏通道理由

- `state:inject`：经 `useBook()` 读阅读位置（手写的依据位置不能晚于它）。
- `io:read`：取依据段（`revisions.evidence`，随对象与所选称呼变）与对象搜索（`entities.list`，随输入变）；两者的参数都由对话框里的选择决定，放在宿主要把选择状态传出去再传回来。
- `io:mutate`：提交时写入（`revisions.link`、`revisions.kind`、`revisions.moveName`），请求期间对话框不能取消，失败写在页脚状态行；写入与它的忙、错误是一件事，经 `useRevise`。
- `env:portal`：nb-ui `Dialog` 脱离调用处渲染。

## 注意事项

依据段只列阅读位置之前的（接口保证）；手写的“章.段”由对话框拦住晚于阅读位置的（接口没有阅读位置参数，只校验是已抽取的段）。对话框由人物卡按需挂载，每次打开都是新实例，所以选择都从初值开始；改种类不预选种类，必须点一个。
