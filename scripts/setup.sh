#!/bin/bash
# 一键初始化开发环境
echo "Setting up development environment..."
pnpm install
cp .env.example .env.local
echo "Done! Run 'pnpm dev' to start."
