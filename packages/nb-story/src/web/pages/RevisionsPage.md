---
标签: ["state:inject"]
---

# 待确认页

对图的修订（docs/specs/story/viewer.md 输出 58、62）：“待确认”页签列出对不上的（先）与待确认的候选身份，“已处理”页签列出已确认、已驳回、后文已确认和用户自己的修订；来源筛选（全部、马甲核对、抽取候选、我的）。一项一张卡片（`RevisionCard`），确认、驳回、撤销、丢弃都经 `useRevise`；点卡片在抽屉打开相关人物卡。列表跟阅读位置走，页头写明。

## 数据

没有 props。

## 隐藏通道理由

`state:inject`：经 `useBook()` 读阅读位置、打开抽屉；取数经 `useStoryQuery`、`usePagedQuery`。

## 注意事项

写入成功后 `book.refresh()` 换新数据，列表按数据版本重取，滚动与抽屉不变。
