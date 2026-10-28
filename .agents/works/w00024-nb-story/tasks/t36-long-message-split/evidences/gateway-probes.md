# t36 网关探测（2026-10-28，gpt-6-luna 所在中转网关）

## 真实网关验证（scripts/gateway-check.ts，t36 分支的 callModel）

```
用户消息 212146 字节
第 1 次：失败 网关拒绝了请求（413）：本次最大的一条消息 25000 字节；413 Request payload is too large
  尝试 1：错误 413 网关拒绝了请求（413）：本次最大的一条消息 212146 字节；413 Request payload is too large，用量 {"input":0,"output":0,"cacheRead":0,"complete":true}
  尝试 2：错误 413 网关拒绝了请求（413）：本次最大的一条消息 50000 字节；413 Request payload is too large，用量 {"input":0,"output":0,"cacheRead":0,"complete":true}
  尝试 3：错误 413 网关拒绝了请求（413）：本次最大的一条消息 25000 字节；413 Request payload is too large，用量 {"input":0,"output":0,"cacheRead":0,"complete":true}
第 2 次：失败 524 status code (no body)
  尝试 1：错误 524 524 status code (no body)，用量 {"input":0,"output":0,"cacheRead":0,"complete":false}
  尝试 2：错误 413 网关拒绝了请求（413）：本次最大的一条消息 212146 字节；413 Request payload is too large，用量 {"input":0,"output":0,"cacheRead":0,"complete":true}
  尝试 3：错误 413 网关拒绝了请求（413）：本次最大的一条消息 50000 字节；413 Request payload is too large，用量 {"input":0,"output":0,"cacheRead":0,"complete":true}
  尝试 4：错误 524 524 status code (no body)，用量 {"input":0,"output":0,"cacheRead":0,"complete":false}
```

## 直接探测（只发 system 一句 + 用户消息，max_tokens 16）

| 时间顺序 | 请求 | 请求体字节 | 结果 |
|---|---|---|---|
| t33（较早） | 单条汉字“一” 50 KB / 70 KB | 5 万 / 7 万 | 200 / 200 |
| t33（较早） | 单条汉字 80 KB、90 KB、100 KB、120 KB、140 KB | 8 万到 14 万 | 413 |
| t33（较早） | 两条汉字各 60 KB | 12 万 | 200 |
| t33（较早） | 汉字 40 KB + 80 KB | 12 万 | 413 |
| t36 计划时 | 四条汉字各 60 KB | 24 万 | 429（限流，未判大小） |
| 本次 | 单条 ASCII “a” 75 KB | 7.5 万 | 200 |
| 本次 | 单条 ASCII 150 KB | 15 万 | 413 |
| 本次 | 三条汉字各 60 KB | 18 万 | 413 |
| 本次 | 四条 ASCII 各 50 KB | 20 万 | 413 |
| 本次 | 两条汉字各 60 KB（复测） | 12 万 | 413 |
| 本次 | 单条 ASCII 85、95、100、105、110 KB | 8.5 万到 11 万 | 全部 200 |

结论：上限不是“单条消息的字节数”（拆成 25 KB 一条的 212 KB 请求仍被拒；两条各 60 KB 汉字这次也被拒），看起来是整个请求的大小，计量口径不明（汉字单条 80 KB 被拒而 ASCII 单条 110 KB 能过，可能按 token 或按转义后的字节），同一个请求在不同时间结果不同（可能不同上游账号的上限不同）。t33 据以下结论的“只限单条、总量不限”只有两个数据点，不成立。
