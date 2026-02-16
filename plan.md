# 为 src/main 增加标准 lint 约束

## 现状分析

项目使用 **oxlint** (v1.43.0) 作为 linter，当前配置 `oxlintrc.json` 只有 3 条 React 规则，
对 `src/main`（218 个 TS 文件，Electron 主进程代码）完全无效。

现有 64 个 warning（全是 `no-unused-vars`），0 error。

## 方案

### 配置更新 — `oxlintrc.json`

为 `src/main` 增加以下约束级别：

**启用分类（deny = error）：**
- `correctness` — 已默认开启，保持
- `suspicious` — 可疑代码检测（如 `preserve-caught-error` 等 20 处）
- `perf` — 性能问题（主要是 `no-await-in-loop` 150 处，需要逐一评估）

**启用规则（挑选 style 中有价值的）：**
- `prefer-const` — warn
- `no-duplicate-imports` — error
- `no-template-curly-in-string` — warn

**TypeScript 特化规则（typescript plugin 默认开启）：**
- `@typescript-eslint/no-explicit-any` — error（配合之前的类型强化）
- `@typescript-eslint/no-non-null-assertion` — warn
- `@typescript-eslint/consistent-type-imports` — warn

**抑制不适合的规则：**
- `no-await-in-loop` — warn（大量 streaming/for-await 场景属合理使用，降为 warn）

### 新增 lint scripts

- `lint:main` — 专门 lint src/main（带 TypeScript 插件 + import 插件）
- `lint:main:fix` — 自动修复

### 修复工作

先修复所有 error 级别问题：
- 63 个 `no-unused-vars`（删除死代码/未使用导入）
- 20 个 `preserve-caught-error`（catch 块空变量 → 使用或命名为 _）
- 1 个 `no-useless-escape`
- 7 个 `no-duplicate-imports`
- 7 个 `prefer-const`

总计约 98 处需修复。
