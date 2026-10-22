/**
 * 一轮真实 harness 运行的会话日志（nb-session 条目），由 nb-harness 的脚本化模型跑出：思考、两次工具调用（其中一次查不到）、
 * 最终回复与用量。“harness 记录回放”场景把它交给 nb-agent-ui 的适配器，看真实日志画成什么样。
 * 重录：照 `packages/nb-agent-ui/src/harness.contract.test.ts` 的写法跑一轮，`log.read()` 的结果原样写在这里。
 */

export const harnessReplayLog: readonly unknown[] = [
  {
    "kind": "session_snapshot",
    "seq": 1,
    "at": "2026-10-22T09:08:16.276Z",
    "profile": {
      "key": "lab-replay",
      "version": "1"
    },
    "initial": {},
    "tools": [
      {
        "id": "lab.read",
        "name": "read",
        "description": "读文件",
        "finish": false,
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string"
            }
          }
        },
        "provider": "profile:lab-replay",
        "version": "1",
        "concurrency": "shared",
        "strict": false
      },
      {
        "id": "lab.search",
        "name": "web_search",
        "description": "搜索",
        "finish": false,
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string"
            }
          }
        },
        "provider": "profile:lab-replay",
        "version": "1",
        "concurrency": "shared",
        "strict": false
      }
    ]
  },
  {
    "kind": "agent_message",
    "seq": 2,
    "at": "2026-10-22T09:08:16.277Z",
    "message": {
      "role": "user",
      "content": "第三章里谁听见了第十二下钟声？",
      "timestamp": 1792660096277
    }
  },
  {
    "kind": "agent_message",
    "seq": 3,
    "at": "2026-10-22T09:08:16.313Z",
    "message": {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "先读第三章，再查一下钟声的说法。"
        },
        {
          "type": "toolCall",
          "id": "r1",
          "name": "read",
          "arguments": {
            "path": "/正文/第三章 雨夜.md"
          }
        },
        {
          "type": "toolCall",
          "id": "s1",
          "name": "web_search",
          "arguments": {
            "query": "钟楼 报时 十二下"
          }
        }
      ],
      "api": "openai-completions",
      "provider": "lab",
      "model": "scripted-model",
      "usage": {
        "input": 1200,
        "output": 80,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 1280,
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0
        }
      },
      "stopReason": "toolUse",
      "timestamp": 1792660096309
    }
  },
  {
    "kind": "usage",
    "seq": 4,
    "at": "2026-10-22T09:08:16.313Z",
    "input": 1200,
    "output": 80,
    "cacheRead": 0,
    "cacheWrite": 0,
    "cost": null
  },
  {
    "kind": "agent_message",
    "seq": 5,
    "at": "2026-10-22T09:08:16.315Z",
    "message": {
      "role": "toolResult",
      "toolCallId": "r1",
      "toolName": "read",
      "content": [
        {
          "type": "text",
          "text": "第三章 雨夜\n\n钟声敲到第十二下，雨还没有停。（/正文/第三章 雨夜.md）"
        }
      ],
      "details": {},
      "isError": false,
      "timestamp": 1792660096315
    }
  },
  {
    "kind": "agent_message",
    "seq": 6,
    "at": "2026-10-22T09:08:16.315Z",
    "message": {
      "role": "toolResult",
      "toolCallId": "s1",
      "toolName": "web_search",
      "content": [
        {
          "type": "text",
          "text": "没有找到相关内容"
        }
      ],
      "details": {},
      "isError": false,
      "timestamp": 1792660096315
    }
  },
  {
    "kind": "agent_message",
    "seq": 7,
    "at": "2026-10-22T09:08:16.316Z",
    "message": {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "第三章里只有**林默**听见了第十二下钟声：他在钟表铺里数着，旁人都以为只敲了十一下。"
        }
      ],
      "api": "openai-completions",
      "provider": "lab",
      "model": "scripted-model",
      "usage": {
        "input": 1500,
        "output": 60,
        "cacheRead": 1100,
        "cacheWrite": 0,
        "totalTokens": 1560,
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0
        }
      },
      "stopReason": "stop",
      "timestamp": 1792660096316
    }
  },
  {
    "kind": "usage",
    "seq": 8,
    "at": "2026-10-22T09:08:16.316Z",
    "input": 1500,
    "output": 60,
    "cacheRead": 1100,
    "cacheWrite": 0,
    "cost": null
  }
];
