/**
 * Transform 重构验证脚本
 *
 * 用途：对比新旧实现的输出一致性
 *
 * 使用方法：
 * 1. 录制真实 SDK 消息流到 fixtures/ 目录
 * 2. 运行此脚本对比输出
 * 3. 检查差异
 *
 * bun run scripts/verify-transform-refactor.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createTransformer as createTransformerV1 } from "../src/main/lib/claude/transform";
import { createTransformer as createTransformerV2 } from "../src/main/lib/claude/transform-v2";

/**
 * 加载录制的 SDK 消息
 */
function loadFixture(filename: string): any[] {
  const filePath = join(__dirname, "../fixtures/transform", filename);
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * 运行转换器并收集输出
 */
function runTransformer(
  transformer: ReturnType<typeof createTransformerV1>,
  messages: any[],
): any[] {
  const chunks: any[] = [];
  for (const msg of messages) {
    for (const chunk of transformer(msg)) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

/**
 * 对比两个 chunk 数组
 */
function compareChunks(v1Chunks: any[], v2Chunks: any[]): {
  identical: boolean;
  differences: string[];
} {
  const differences: string[] = [];

  if (v1Chunks.length !== v2Chunks.length) {
    differences.push(
      `Length mismatch: V1=${v1Chunks.length}, V2=${v2Chunks.length}`,
    );
  }

  const minLength = Math.min(v1Chunks.length, v2Chunks.length);
  for (let i = 0; i < minLength; i++) {
    const v1 = v1Chunks[i];
    const v2 = v2Chunks[i];

    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      differences.push(
        `Chunk ${i} differs:\n  V1: ${JSON.stringify(v1)}\n  V2: ${JSON.stringify(v2)}`,
      );
    }
  }

  return {
    identical: differences.length === 0,
    differences,
  };
}

/**
 * 主函数
 */
async function main() {
  console.log("🔍 Transform 重构验证脚本\n");

  // TODO: 录制真实 SDK 消息到 fixtures/transform/ 目录
  // 示例文件：
  // - bash-background-task.json
  // - nested-tool-calls.json
  // - extended-thinking.json
  // - stream-interruption.json

  const fixturesDir = join(__dirname, "../fixtures/transform");
  try {
    const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

    if (fixtures.length === 0) {
      console.log("⚠️  未找到测试数据，请先录制 SDK 消息到 fixtures/transform/");
      console.log("   提示：可以在 claude.ts 中添加消息录制逻辑");
      return;
    }

    let totalTests = 0;
    let passedTests = 0;

    for (const fixture of fixtures) {
      console.log(`\n📝 测试场景: ${fixture}`);
      totalTests++;

      const messages = loadFixture(fixture);
      console.log(`   消息数量: ${messages.length}`);

      // 运行两个版本
      const transformerV1 = createTransformerV1();
      const transformerV2 = createTransformerV2();

      const v1Chunks = runTransformer(transformerV1, messages);
      const v2Chunks = runTransformer(transformerV2, messages);

      console.log(`   V1 输出: ${v1Chunks.length} chunks`);
      console.log(`   V2 输出: ${v2Chunks.length} chunks`);

      // 对比
      const result = compareChunks(v1Chunks, v2Chunks);

      if (result.identical) {
        console.log("   ✅ 输出一致");
        passedTests++;
      } else {
        console.log("   ❌ 输出不一致");
        result.differences.forEach((diff) => console.log(`      ${diff}`));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`总计: ${passedTests}/${totalTests} 测试通过`);
    console.log(`${"=".repeat(60)}\n`);

    if (passedTests === totalTests) {
      console.log("🎉 所有测试通过！新旧实现输出一致。");
      process.exit(0);
    } else {
      console.log("⚠️  存在差异，需要进一步调查。");
      process.exit(1);
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log("⚠️  fixtures/transform/ 目录不存在");
      console.log("   请创建目录并录制 SDK 消息");
    } else {
      console.error("❌ 错误:", error);
    }
    process.exit(1);
  }
}

main();
