# 受审分支安全集成计划

日期：2026-08-29

## 范围

- 审查并集成 `codex/integrate-upstream-0.21`。
- 用 `codex/fix-raster-metadata-upstream` 承载最新 upstream 与 raster metadata 修复。
- 集成 `codex/fix-mcp-dev-duplicate-instance` 的开发版 MCP 单实例修复。
- 仅在有效补丁未被前述分支覆盖时才集成 `codex/fix-raster-metadata-validation`。

## 不动项

- 不删除任何分支。
- 不 force push，也不直接 push `main`。
- 不接受 `validation` 分支中未经解释的生成 CSS 大幅膨胀。
- 冲突按现有代码语义逐处解决，不使用整树 `ours` / `theirs` 覆盖。

## 顺序

1. 从当前本地 `main` 创建独立集成 worktree。
2. 合并 `codex/integrate-upstream-0.21`，验证 H3 与 upstream v0.21 整合。
3. 合并 `codex/fix-raster-metadata-upstream`，带入最新 upstream 与新版 raster 修复。
4. 跳过已被覆盖的 `validation` 提交；单独审查其额外 workflow/CSS 提交。
5. 合并 `codex/fix-mcp-dev-duplicate-instance`。
6. 运行完整 push 前门禁；通过后将本地 `main` 快进到集成结果。

## 回滚

- 每一步都是独立 merge commit；最终快进前，原 `main` 始终停在 `4ab758dc`。
- 若某一步不能在代码逻辑与测试层面证明正确，终止该次 merge 并保持该目标分支未合入。

## 验收门

- 每个 merge 后至少运行受影响模块的定向测试，并检查未解决冲突。
- 最终运行 `check:filesize`、`check:tokens`、`check:i18n`、`lint:ci`、`typecheck`、`test`、`build`。
- 最终分支包含 H3 集成、最新 raster metadata 修复与 MCP 单实例修复，且不包含异常 CSS 膨胀。
