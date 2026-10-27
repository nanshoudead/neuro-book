---
标签: [io:mutate, env:route]
---

# 导入记忆图文件

导入页（`/import`）里“导入原文”下面的一节（docs/specs/story/viewer.md 输出 54）：选一份 nbstory 抽好的 V9 记忆图文件（JSON，或 gzip 压缩的 JSON，不超过 32 MiB），书名可以不填（取文件里的），点“导入”，成功后跳到这本书；命令行 `nbstory import` 的网页版，不调用模型。

## 布局

一个带边框的区块：标题与一行说明、文件行（图标、文件名、选择按钮）、选了文件后出书名输入（空着用文件里的书名）与“导入”按钮、出错时一行红字。

## 状态与副作用

- `io:mutate`：调服务的 `book.importGraph`，会新建一本书。理由：导入是这个页面唯一的动作，没有别处发起它。
- `env:route`：成功后跳到 `/book/<id>`。
- 文件在浏览器里读成 base64 再发；错误按码给话：`book_exists`（同 id 的书已存在，换书名）、`unsupported_format`（不是 V9 记忆图）、其余原样写服务给的说明。

## 验证入口

导入页（`e2e/viewer.e2e.ts`：选 JSON 导入后跳到新书，重复导入报已存在，坏文件报不是记忆图）。
