/**
 * 测试脚本：验证记忆系统初始化流程
 *
 * 用法:
 * bun scripts/test-memory-init.ts
 */

import { MemoryInitManager } from "../src/main/feature/memory/lib/init-manager"

const log = console.log

async function testInitManager() {
  log("\n========== 测试 MemoryInitManager ==========\n")

  const manager = MemoryInitManager.getInstance()

  // 1. 检查初始状态
  log("1. 初始状态:")
  const initialStatus = manager.getStatus()
  log(`   state: ${initialStatus.state}`)
  log(`   isReady: ${manager.isReady()}`)

  // 2. 触发初始化
  log("\n2. 触发初始化...")
  const startTime = Date.now()

  try {
    await manager.initialize()
    const duration = Date.now() - startTime
    log(`   ✓ 初始化成功 (耗时 ${duration}ms)`)
  } catch (error) {
    log(`   ✗ 初始化失败:`, error)
  }

  // 3. 检查初始化后的状态
  log("\n3. 初始化后状态:")
  const finalStatus = manager.getStatus()
  log(`   state: ${finalStatus.state}`)
  if (finalStatus.state === "initializing") {
    log(`   phase: ${finalStatus.phase}`)
  }
  if (finalStatus.state === "failed") {
    log(`   error: ${finalStatus.error}`)
    log(`   retryCount: ${finalStatus.retryCount}`)
    log(`   nextRetryAt: ${new Date(finalStatus.nextRetryAt).toISOString()}`)
  }
  log(`   isReady: ${manager.isReady()}`)

  // 4. 测试重复初始化(应该立即返回)
  log("\n4. 测试重复初始化...")
  const start2 = Date.now()
  await manager.initialize()
  const duration2 = Date.now() - start2
  log(`   ✓ 重复初始化完成 (耗时 ${duration2}ms, 应该很快)`)

  // 5. 清理
  log("\n5. 清理资源...")
  manager.cleanup()
  log("   ✓ 清理完成")

  log("\n========== 测试完成 ==========\n")
}

// 运行测试
testInitManager().catch((err) => {
  console.error("测试失败:", err)
  process.exit(1)
})
