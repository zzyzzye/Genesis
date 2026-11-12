#!/bin/sh
# 仅由部署服务器上的临时 Node 容器执行；构建失败不切换线上静态文件。
set -eu
action=${1:?缺少部署动作}
artifacts=${3:-/artifacts}
if [ "$action" = check ]; then
    test -s "$artifacts/current/index.html"
    exit
fi
release=${2:?缺少发布标识}
case "$release" in *[!a-z0-9-]*|'') echo '发布标识无效' >&2; exit 1 ;; esac
target="$artifacts/releases/$release"
if [ "$action" = build ]; then
    current=$(readlink "$artifacts/current" || true)
    previous_release=$(readlink "$artifacts/previous" || true)
    # 清理上次未发布成功的候选，反复失败也不会持续积累静态包。
    for directory in "$artifacts"/releases/*; do
        [ -d "$directory" ] || continue
        if [ "$directory" != "$artifacts/$current" ] && [ "$directory" != "$artifacts/$previous_release" ]; then
            rm -rf "$directory"
        fi
    done
    mkdir -p "$target"
    trap 'rm -rf "$target"' EXIT
    # 不复制环境文件、构建产物或宿主机依赖，不把秘密打入浏览器包。
    tar -C /source --exclude='./node_modules' --exclude='./dist' --exclude='./.env*' \
        --exclude='./coverage' --exclude='./.git' --exclude='./.vite' -cf - . | tar -C /work -xf -
    lock=$(sha256sum package.json package-lock.json | sha256sum | cut -d ' ' -f 1)
    previous=$(cat node_modules/.genesis-lock 2>/dev/null || true)
    if [ "$previous" != "$lock" ] || [ ! -x node_modules/.bin/vite ]; then
        npm ci --include=dev --no-audit --no-fund
        printf '%s' "$lock" > node_modules/.genesis-lock
    fi
    npm run build -- --outDir "$target"
    test -s "$target/index.html"
    trap - EXIT
elif [ "$action" = publish ]; then
    test -s "$target/index.html"
    old=$(readlink "$artifacts/current" || true)
    ln -sfn "releases/$release" "$artifacts/current-next"
    mv -Tf "$artifacts/current-next" "$artifacts/current"
    if [ -n "$old" ]; then ln -sfn "$old" "$artifacts/previous"; fi
    # 保留本次和上次发布；数据库、素材卷及其他项目完全不参与清理。
    for directory in "$artifacts"/releases/*; do
        [ -d "$directory" ] || continue
        if [ "$directory" != "$target" ] && [ "$directory" != "$artifacts/$old" ]; then
            rm -rf "$directory"
        fi
    done
else
    echo '未知部署动作' >&2
    exit 1
fi
