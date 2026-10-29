# t34 评分结果

2026-10-28。由这条命令生成（仓库根执行），只读冻结的 [gold.json](gold.json) 与 `.local` 的 `runs/`：

```
bun .agents/works/w00024-nb-story/tasks/t34-persona-link-probe/scripts/score.ts
```

第一次启动时脚本在建结果目录之前就去扫描它，直接退出，没有发出请求；补上建目录后重跑。

请求 308（两遍），没有记录 0，失败 0；费用 ¥1.03（下界，deepseek-flash 低谷价），每次约 ¥0.0033。

## 揭示后（问题 1）

| 分层 | 次数 | 答对且确定 | 答对但写候选 | 答错 | 不知道 | 失败 |
|---|---|---|---|---|---|---|
| explicit | 52 | 39 | 7 | 0 | 6 | 0 |
| label | 70 | 29 | 16 | 4 | 19 | 0 |
| inferred | 16 | 12 | 3 | 0 | 1 | 0 |

每个用例揭示后第几次问到时答对（certain 或 candidate 都算；- 表示揭示后的几次都没答对）：

| 用例 | 分层 | 揭示章 | 第 1 遍 | 第 2 遍 | 揭示后问的章 |
|---|---|---|---|---|---|
| witch-e6-4 | label | 6 | 2（第 7 章，候选） | 2（第 7 章，候选） | 6、7、9、10、12 |
| witch-e6-5 | label | 6 | 5（第 12 章，候选） | 2（第 7 章） | 6、7、9、10、12 |
| witch-e7-1 | explicit | 7 | 1（第 7 章） | 1（第 7 章） | 7、9、10、12、15 |
| witch-e24-3 | explicit | 24 | 1（第 24 章，候选） | 1（第 24 章，候选） | 24 |
| witch-e18-1 | inferred | 19 | 1（第 19 章，候选） | 1（第 19 章） | 19、24、25 |
| sample-e3-2 | explicit | 4 | 1（第 4 章） | 1（第 4 章） | 4、5、6、7、8 |
| sample-e5-1 | label | 5（漏触发） | 1（第 6 章，候选） | 1（第 6 章，候选） | 6、8、10、12、16 |
| sample-e6-2 | explicit | 6 | 1（第 6 章） | 1（第 6 章） | 6、7、8、9、10 |
| sample-e8-2 | inferred | 10 | 1（第 10 章） | 1（第 10 章） | 10、11、12、15、16 |
| sample-e10-1 | label | 10（漏触发） | 2（第 16 章，候选） | 1（第 12 章，候选） | 12、16、20、26、30 |
| sample-e26-2 | explicit | 27 | 1（第 27 章） | 1（第 27 章） | 27、28、29、30、31 |
| sample-e30-1 | label | 33 | 1（第 33 章） | 1（第 33 章） | 33、34、35、36、37 |
| sample-e33-1 | label | 33 | 1（第 33 章，候选） | 1（第 33 章） | 33、34、35、36、37 |
| sample-e66-1 | explicit | 66 | 1（第 66 章，候选） | 3（第 70 章） | 66、68、70、71、72 |
| sample-e90-1 | label | 93 | 1（第 93 章） | 1（第 93 章） | 93、94、95、96、97 |

## 揭示前（问题 2）

揭示前共问 18 次：提前确定 0，提前猜 0，有根据的猜 1，答错 1，不知道 16，失败 0。
- 第 2 遍 sample-e30-1 第 30 章（揭示 33）：wrong，答 same e26-2 candidate｜深蓝猫娘变身后成为注视鸢尾花的华丽魔法少女，与候选 e26-2 的白色魔法少女身份存在关联线索，但材料未明确说明二者是同一个体。

## 不是马甲与一直没揭示（问题 3）

| 用例 | 次数 | 答对 | 答错 | 不知道 | 失败 | 答错时答的 |
|---|---|---|---|---|---|---|
| witch-e4-1（not-persona） | 44 | 0 | 15 | 29 | 0 | same:e4-2:candidate、same:e5-1:candidate、same:e9-2:candidate、same:e9-2:certain、same:e5-1:certain |
| witch-e4-2（not-persona） | 44 | 0 | 5 | 39 | 0 | same:e5-1:certain、same:e9-2:certain |
| witch-e10-4（not-persona） | 14 | 9 | 0 | 5 | 0 |  |
| sample-e58-1（never） | 18 | 0 | 0 | 18 | 0 |  |
| sample-e58-2（never） | 18 | 0 | 0 | 18 | 0 |  |
| sample-e88-1（never） | 10 | 0 | 1 | 9 | 0 | same:e8-2:candidate |
| sample-e98-5（never） | 4 | 0 | 0 | 4 | 0 |  |

## 触发与费用（问题 4）

- witch：8 个马甲用例，按触发规则不封顶共 85 次，平均每章 2.8 次
- sample：14 个马甲用例，按触发规则不封顶共 547 次，平均每章 5.5 次

“答出就停”回放（产品策略：第一次答 same 或 not-persona 就写下或进待确认，之后不再问）：

| 遍 | 用例 | 停在 | 那一次的归类 | 停之前问了几次 |
|---|---|---|---|---|
| 1 | witch-e6-4 | 第 7 章 | cautious | 2 |
| 1 | witch-e6-5 | 第 7 章 | wrong | 2 |
| 1 | witch-e7-1 | 第 7 章 | correct | 1 |
| 1 | witch-e24-3 | 第 24 章 | cautious | 1 |
| 1 | witch-e18-1 | 第 19 章 | cautious | 2 |
| 1 | witch-e4-1 | 第 4 章 | wrong | 1 |
| 1 | witch-e4-2 | 第 7 章 | wrong | 4 |
| 1 | witch-e10-4 | 第 12 章 | correct | 2 |
| 1 | sample-e3-2 | 第 4 章 | correct | 2 |
| 1 | sample-e5-1 | 第 6 章 | cautious | 1 |
| 1 | sample-e6-2 | 第 6 章 | correct | 1 |
| 1 | sample-e8-2 | 第 10 章 | correct | 3 |
| 1 | sample-e10-1 | 第 16 章 | cautious | 2 |
| 1 | sample-e26-2 | 第 27 章 | correct | 2 |
| 1 | sample-e30-1 | 第 30 章 | guess-ok | 1 |
| 1 | sample-e33-1 | 第 33 章 | cautious | 1 |
| 1 | sample-e66-1 | 第 66 章 | cautious | 1 |
| 1 | sample-e90-1 | 第 93 章 | correct | 3 |
| 2 | witch-e6-4 | 第 7 章 | cautious | 2 |
| 2 | witch-e6-5 | 第 7 章 | correct | 2 |
| 2 | witch-e7-1 | 第 7 章 | correct | 1 |
| 2 | witch-e24-3 | 第 24 章 | cautious | 1 |
| 2 | witch-e18-1 | 第 19 章 | correct | 2 |
| 2 | witch-e4-1 | 第 4 章 | wrong | 1 |
| 2 | witch-e4-2 | 第 7 章 | wrong | 4 |
| 2 | witch-e10-4 | 第 12 章 | correct | 2 |
| 2 | sample-e3-2 | 第 4 章 | correct | 2 |
| 2 | sample-e5-1 | 第 6 章 | cautious | 1 |
| 2 | sample-e6-2 | 第 6 章 | correct | 1 |
| 2 | sample-e8-2 | 第 10 章 | correct | 3 |
| 2 | sample-e10-1 | 第 12 章 | cautious | 1 |
| 2 | sample-e26-2 | 第 27 章 | correct | 2 |
| 2 | sample-e30-1 | 第 30 章 | wrong | 1 |
| 2 | sample-e33-1 | 第 33 章 | correct | 1 |
| 2 | sample-e66-1 | 第 70 章 | correct | 3 |
| 2 | sample-e88-1 | 第 90 章 | wrong | 2 |
| 2 | sample-e90-1 | 第 93 章 | correct | 3 |

回放合计：cautious 11，wrong 7，correct 18，guess-ok 1。

两遍一致：134/154（87%），按 verdict 与对象。
