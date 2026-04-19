#!/bin/bash
# entrypoint.sh — 动态发现 WSL2 Blackwell (sm_120) PTX JIT 驱动路径
# 问题背景：RTX 5070 Ti (sm_120) 在 Docker/WSL2 中需要 libnvidia-ptxjitcompiler.so.1
# 该库由 Windows 驱动注入到 /usr/lib/wsl/drivers/<hash>/ 目录，但默认不在 LD_LIBRARY_PATH 中
# 缺失时，任何需要 PTX JIT 编译的 CUDA kernel 都会无声崩溃（SIGSEGV，无 Python traceback）

WSL_PTX_DIR=""
for dir in /usr/lib/wsl/drivers/*/; do
    if [ -f "${dir}libnvidia-ptxjitcompiler.so.1" ]; then
        WSL_PTX_DIR="$dir"
        break
    fi
done

if [ -n "$WSL_PTX_DIR" ]; then
    export LD_LIBRARY_PATH="${WSL_PTX_DIR}:${LD_LIBRARY_PATH:-}"
    echo "[entrypoint] ✅ WSL2 PTX JIT compiler found: ${WSL_PTX_DIR}"
else
    echo "[entrypoint] ⚠️  WSL2 PTX JIT compiler not found in /usr/lib/wsl/drivers/. sm_120 kernels may crash."
fi

exec "$@"
