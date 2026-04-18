# ADR-002: Authentication Strategy

## Status
Not Applicable (v1.0)

## Context
v1.0 定位为单用户本地工具，所有服务运行在用户本机 Docker 中，无多用户场景，无需鉴权。

## Decision
v1.0 不实现任何认证机制。Web UI 和 API 均为开放访问。

## Future Consideration
若 v2.0 扩展为 SaaS 或多用户共享 GPU 场景，再重新评估认证方案（如 JWT + OAuth2）。
