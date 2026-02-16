# Transform V2 迁移指南

本文档说明如何从旧版 transform 切换到新版重构实现。

---

## 🎯 迁移策略：渐进式切换

我们采用渐进式切换策略，确保安全平稳过渡：

1. **阶段 1：验证测试**（1-2 天）
2. **阶段 2：Canary 部署**（3-5 天）
3. **阶段 3：灰度发布**（1 周）
4. **阶段 4：全量切换**（1 天）
5. **阶段 5：清理旧代码**（1 天）

---

## 📋 前置检查清单

在切换前，确保完成以下验证：

### ✅ 编译验证
```bash
bun run build
# 预期：✓ built in ~2m
```

### ✅ 单元测试
```bash
bun test transform/__tests__/
# 预期：所有测试通过
```

### ✅ 集成测试
```bash
bun run scripts/verify-transform-refactor.ts
# 预期：所有场景输出一致
```

### ✅ 性能基准
```bash
bun run scripts/benchmark-transform.ts
# 预期：P99 延迟增长 <5%
```

---

## 🚀 阶段 1：验证测试（本地/CI）

### 步骤 1.1：本地测试

```bash
# 使用新版本启动开发环境
USE_TRANSFORM_V2=true bun run dev

# 测试关键场景：
# 1. 基本对话
# 2. 工具调用（Read, Glob, Grep）
# 3. Bash 后台任务
# 4. 嵌套工具（Explore agent）
# 5. Extended Thinking（如支持）
```

### 步骤 1.2：快照测试

```bash
# 录制真实 SDK 消息
# 在 claude.ts 中临时添加消息录制代码
# （见 fixtures/transform/README.md）

# 运行快照测试
bun run scripts/verify-transform-refactor.ts

# 预期输出：
# ✅ bash-background-task.json 输出一致
# ✅ nested-tool-calls.json 输出一致
# ✅ extended-thinking.json 输出一致
```

### 步骤 1.3：性能测试

```bash
# 运行性能基准测试
bun run scripts/benchmark-transform.ts

# 关键指标：
# - P50 延迟：应接近旧版
# - P99 延迟：增长应 <5%
# - 内存使用：应无明显增长
```

### 验收标准

- ✅ 所有快照测试通过（输出一致）
- ✅ P99 延迟增长 <5%
- ✅ 无崩溃或错误

---

## 🧪 阶段 2：Canary 部署（开发环境）

### 步骤 2.1：配置 Canary

在 `.env.production` 中添加：

```env
# Canary：10% 用户使用新版本
TRANSFORM_V2_ROLLOUT_PERCENTAGE=10
```

### 步骤 2.2：实现流量分配

修改 `src/main/lib/claude/transform-factory.ts`：

```typescript
const USE_TRANSFORM_V2 =
  process.env.USE_TRANSFORM_V2 === "true" ||
  process.env.USE_TRANSFORM_V2 === "1" ||
  // Canary：基于用户 ID 随机分配
  (process.env.TRANSFORM_V2_ROLLOUT_PERCENTAGE &&
   Math.random() * 100 < Number(process.env.TRANSFORM_V2_ROLLOUT_PERCENTAGE));
```

### 步骤 2.3：监控关键指标

在 Sentry / 日志系统中监控：

1. **错误率**
   - 新版错误数 vs 旧版错误数
   - 关键错误：JSON 解析失败、chunk 类型错误

2. **性能指标**
   - P50/P95/P99 延迟
   - 内存使用峰值

3. **用户反馈**
   - 崩溃报告
   - UI 渲染异常

### 步骤 2.4：添加日志标记

在 `transform-factory.ts` 中添加版本标记：

```typescript
export function createTransformer(options) {
  if (USE_TRANSFORM_V2) {
    console.log("[Transform] Using V2 (refactored)");
    // 在 Sentry 中添加 tag
    Sentry.setTag("transform_version", "v2");
    return createTransformerV2(options);
  } else {
    console.log("[Transform] Using V1 (legacy)");
    Sentry.setTag("transform_version", "v1");
    return createTransformerV1(options);
  }
}
```

### 验收标准（观察 3-5 天）

- ✅ 错误率无明显上升（<1% 增长）
- ✅ P99 延迟无明显恶化（<5% 增长）
- ✅ 无崩溃或严重 bug
- ✅ 用户无负面反馈

---

## 📈 阶段 3：灰度发布（逐步扩大）

### 步骤 3.1：扩大 Canary 比例

如果 Canary 期间无问题，逐步扩大：

```env
# 第 1 天：10%
TRANSFORM_V2_ROLLOUT_PERCENTAGE=10

# 第 3 天：25%
TRANSFORM_V2_ROLLOUT_PERCENTAGE=25

# 第 5 天：50%
TRANSFORM_V2_ROLLOUT_PERCENTAGE=50

# 第 7 天：75%
TRANSFORM_V2_ROLLOUT_PERCENTAGE=75
```

### 步骤 3.2：持续监控

每次扩大比例后，观察 24-48 小时：
- 错误率趋势
- 性能指标趋势
- 用户反馈

### 步骤 3.3：回滚机制

如果发现问题，立即回滚：

```bash
# 方式 1：环境变量（立即生效）
TRANSFORM_V2_ROLLOUT_PERCENTAGE=0

# 方式 2：热修复（紧急情况）
USE_TRANSFORM_V2=false

# 方式 3：代码回滚
git revert <commit-hash>
```

### 验收标准（观察 1 周）

- ✅ 50% 流量下运行稳定
- ✅ 所有指标正常
- ✅ 无用户投诉

---

## ✅ 阶段 4：全量切换

### 步骤 4.1：设置默认版本

修改 `transform-factory.ts`：

```typescript
// 旧版（Phase 3 之前）
const USE_TRANSFORM_V2 =
  process.env.USE_TRANSFORM_V2 === "true" ||
  /* ... Canary 逻辑 */;

// 新版（Phase 4）
const USE_TRANSFORM_V2 =
  process.env.USE_TRANSFORM_V2 !== "false"; // 默认使用 V2
```

或直接修改调用方：

```typescript
// src/main/lib/trpc/routers/claude.ts
import { createTransformer } from "../claude/transform-v2"; // 直接使用 V2
```

### 步骤 4.2：部署全量

```bash
# 更新环境变量
echo "USE_TRANSFORM_V2=true" >> .env.production

# 构建并部署
bun run build:prod
bun run release
```

### 步骤 4.3：观察 24-48 小时

持续监控所有指标，确保全量切换后无问题。

### 验收标准

- ✅ 所有用户使用新版本
- ✅ 运行稳定 48 小时
- ✅ 无严重问题

---

## 🧹 阶段 5：清理旧代码

### 步骤 5.1：删除旧实现

```bash
# 删除旧文件
rm src/main/lib/claude/transform.ts

# 删除工厂文件（如果已直接导入 V2）
rm src/main/lib/claude/transform-factory.ts
```

### 步骤 5.2：更新导入

将所有 `transform-v2.ts` 重命名为 `transform.ts`：

```bash
mv src/main/lib/claude/transform-v2.ts src/main/lib/claude/transform.ts
```

更新导入语句：

```typescript
// 旧版
import { createTransformer } from "../claude/transform-v2";

// 新版
import { createTransformer } from "../claude/transform";
```

### 步骤 5.3：更新文档

在 `CLAUDE.md` 中记录重构历史：

```markdown
## Transform 模块

**历史**：
- 2026-02-16：完成重构，从 809 行单文件拆分为 16 个模块化组件
- 2026-02-XX：全量切换到新版本
- 2026-02-XX：删除旧代码

**架构**：见 `src/main/lib/claude/transform/` 目录
```

### 步骤 5.4：清理环境变量

删除不再需要的配置：

```bash
# 从 .env.production 中删除
# TRANSFORM_V2_ROLLOUT_PERCENTAGE
# USE_TRANSFORM_V2
```

---

## ⚠️ 常见问题与解决方案

### 问题 1：输出不一致

**症状**：快照测试失败，chunk 顺序或内容不同

**排查**：
1. 检查具体差异：哪个 chunk 不同？
2. 验证状态管理：是否有状态泄漏？
3. 对比日志：新旧版本的处理流程

**解决**：
- 修复状态管理 bug
- 调整 chunk 生成逻辑
- 更新去重逻辑

### 问题 2：性能回退

**症状**：P99 延迟增长 >5%

**排查**：
1. 使用 Chrome DevTools 分析性能
2. 检查 Generator 函数是否有不必要的迭代
3. 检查是否有内存泄漏

**解决**：
- 优化热点代码路径
- 减少对象创建
- 使用对象池（如有必要）

### 问题 3：工具增强器失效

**症状**：Bash 后台任务未检测到

**排查**：
1. 检查 ToolRegistry 是否正确注册
2. 检查工具名是否匹配
3. 检查 enhanceOutput 是否被调用

**解决**：
- 验证 `matches()` 逻辑
- 添加调试日志
- 检查工具名追踪

### 问题 4：嵌套工具 ID 错误

**症状**：tool_result 匹配失败

**排查**：
1. 检查 IdManager 的 compositeId 逻辑
2. 检查 parent_tool_use_id 追踪
3. 验证 ID 映射存储

**解决**：
- 修复 makeCompositeId 逻辑
- 确保 setMapping 在正确时机调用
- 添加 ID 映射日志

---

## 📞 联系与支持

如果在迁移过程中遇到问题：

1. **查看文档**：
   - `TRANSFORM_REFACTOR_COMPLETE.md` - 技术细节
   - `TRANSFORM_REFACTOR_PROGRESS.md` - 实施进度

2. **查看测试**：
   - `src/main/lib/claude/transform/__tests__/` - 单元测试
   - `scripts/verify-transform-refactor.ts` - 快照测试

3. **回滚**：如有严重问题，立即回滚到旧版本

---

## ✅ 迁移检查清单

- [ ] 阶段 1：验证测试
  - [ ] 本地测试通过
  - [ ] 快照测试通过
  - [ ] 性能测试通过

- [ ] 阶段 2：Canary 部署
  - [ ] 配置 10% 流量
  - [ ] 监控指标正常（3-5 天）
  - [ ] 无用户投诉

- [ ] 阶段 3：灰度发布
  - [ ] 扩大到 25%（观察 2 天）
  - [ ] 扩大到 50%（观察 2 天）
  - [ ] 扩大到 75%（观察 2 天）

- [ ] 阶段 4：全量切换
  - [ ] 100% 流量切换
  - [ ] 观察 48 小时
  - [ ] 所有指标正常

- [ ] 阶段 5：清理旧代码
  - [ ] 删除 transform.ts
  - [ ] 重命名 transform-v2.ts
  - [ ] 更新文档
  - [ ] 清理环境变量

---

**预计总时长**：2-3 周
**风险等级**：低（已充分测试 + 渐进式切换）
**回滚时间**：< 5 分钟（环境变量切换）
