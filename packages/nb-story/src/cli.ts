#!/usr/bin/env bun
/**
 * `nbstory` 的入口：从仓库运行 `bun packages/nb-story/src/cli.ts <命令>`。
 */

import {main} from "./cli/main";

process.exitCode = await main(process.argv.slice(2));
