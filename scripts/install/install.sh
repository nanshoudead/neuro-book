#!/bin/sh
set -eu

case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) ;;
    *) echo "NeuroBook Manager v1 Stage 0 只支持 Linux x64 glibc。" >&2; exit 1 ;;
esac

BUN_VERSION="${NEURO_BOOK_BUN_VERSION:-1.3.14}"
MANAGER_TAG="${NEURO_BOOK_MANAGER_TAG:-canary}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
RUNTIME_ROOT="$CACHE_HOME/neuro-book-manager/runtime/bun/$BUN_VERSION"
BUN_BIN="$RUNTIME_ROOT/bun-linux-x64/bun"
ASSET_URL="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"

if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    echo "NeuroBook Manager v1 只支持 Linux x64 glibc。" >&2
    exit 1
fi

if [ ! -x "$BUN_BIN" ]; then
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' EXIT INT TERM
    base="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
    curl -fsSL "$ASSET_URL" -o "$stage/bun-linux-x64.zip"
    curl -fsSL "$base/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
    expected="$(awk '$2 == "bun-linux-x64.zip" {print $1; exit}' "$stage/SHASUMS256.txt")"
    actual="$(sha256sum "$stage/bun-linux-x64.zip" | awk '{print $1}')"
    test -n "$expected" && test "$actual" = "$expected"
    mkdir -p "$RUNTIME_ROOT"
    unzip -q "$stage/bun-linux-x64.zip" -d "$RUNTIME_ROOT"
fi

export NEURO_BOOK_STAGE0_BUN_PATH="$BUN_BIN"
export NEURO_BOOK_STAGE0_BUN_VERSION="$BUN_VERSION"
export NEURO_BOOK_STAGE0_BUN_SOURCE_URL="$ASSET_URL"
export NEURO_BOOK_STAGE0_BUN_SHA256="$(sha256sum "$BUN_BIN" | awk '{print $1}')"
exec "$BUN_BIN" x --bun "@notnotype/neuro-book-manager@$MANAGER_TAG" install "$@"
