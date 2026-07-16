#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {preparePrismaEnv} from "./prisma-env.mjs";

const env = preparePrismaEnv();
const bunCommand = process.execPath;

await runPrismaGenerate(["x", "prisma", "generate", "--config", "./prisma.config.ts"]);
await runPrismaGenerate(["x", "prisma", "generate", "--schema", "./prisma/project.schema.prisma"]);
await assertGeneratedClientVersions();

async function runPrismaGenerate(args) {
    const code = await new Promise((resolveExit) => {
        const child = spawn(bunCommand, args, {
            env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
            stdio: "inherit",
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            resolveExit(code ?? 1);
        });
    });

    if (code !== 0) {
        process.exit(code);
    }
}

async function assertGeneratedClientVersions() {
    const expectedVersion = JSON.parse(await readFile(resolve("node_modules", "@prisma", "client", "package.json"), "utf-8")).version;
    const generatedFiles = [
        "server/generated/prisma/internal/class.ts",
        "server/generated/project-prisma/internal/class.ts",
    ];
    const mismatches = [];

    for (const generatedFile of generatedFiles) {
        const filePath = resolve(generatedFile);
        const text = await readFile(filePath, "utf-8");
        const match = text.match(/"clientVersion":\s*"([^"]+)"/u);
        const actualVersion = match?.[1] ?? null;
        if (actualVersion !== expectedVersion) {
            mismatches.push(`${generatedFile}: ${actualVersion ?? "missing"} != ${expectedVersion}`);
        }
    }

    if (mismatches.length > 0) {
        throw new Error([
            "Prisma generated client version mismatch.",
            "Run `bun run generate` after changing Prisma dependencies.",
            ...mismatches,
        ].join("\n"));
    }
}
