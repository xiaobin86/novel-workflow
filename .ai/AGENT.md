# AGENT.md — 主指令文件
# 本文件是 AI Agent 的主入口，定义通用行为准则和上下文引用。
# 详细内容分区见项目文档 3.9.2。

## Context（上下文声明）
# 在此声明公司级/团队级文档的远程引用路径

## Specs（行为准则引用）
# 引用 .ai/specs/ 下的通用 Spec
- @import specs/_base.md
- @import specs/coding.md
- @import specs/review.md
- @import specs/testing.md
- @import specs/refactor.md
- @import specs/docs.md
- @import specs/devops.md

## Skills（技能声明）
# 引用 .ai/skills/ 下的技能包
