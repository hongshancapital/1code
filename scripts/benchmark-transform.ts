/**
 * Transform 性能基准测试
 *
 * 对比新旧实现的性能指标：
 * - P50/P95/P99 延迟
 * - 内存使用
 * - CPU 使用
 *
 * 使用方法：
 * bun run scripts/benchmark-transform.ts
 */

import { performance } from "perf_hooks";
import { readFileSync } from "fs";
import { join } from "path";
import { createTransformer as createTransformerV1 } from "../src/main/lib/claude/transform";
import { createTransformer as createTransformerV2 } from "../src/main/lib/claude/transform-v2";

interface BenchmarkResult {
  version: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  p50: number;
  p95: number;
  p99: number;
  minTime: number;
  maxTime: number;
  throughput: number; // chunks per second
}

/**
 * 加载测试数据
 */
function loadTestData(): any[] {
  // TODO: 使用真实录制的 SDK 消息
  // 当前使用模拟数据
  return [
    { type: "system", subtype: "init" },
    {
      type: "stream_event",
      event: { type: "content_block_start", content_block: { type: "text" } },
    },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " World" },
      },
    },
    { type: "stream_event", event: { type: "content_block_stop" } },
    {
      type: "result",
      session_id: "test",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  ];
}

/**
 * 运行单次测试
 */
function runSingleTest(
  transformer: ReturnType<typeof createTransformerV1>,
  messages: any[],
): { duration: number; chunkCount: number } {
  const start = performance.now();

  let chunkCount = 0;
  for (const msg of messages) {
    for (const chunk of transformer(msg)) {
      chunkCount++;
      // 模拟实际处理
      void chunk;
    }
  }

  const duration = performance.now() - start;
  return { duration, chunkCount };
}

/**
 * 运行基准测试
 */
function runBenchmark(
  version: string,
  createTransformer: typeof createTransformerV1,
  messages: any[],
  iterations: number = 1000,
): BenchmarkResult {
  console.log(`\n🔬 测试 ${version} (${iterations} 次迭代)`);

  const durations: number[] = [];
  let totalChunks = 0;

  // 预热（避免 JIT 影响）
  for (let i = 0; i < 10; i++) {
    const transformer = createTransformer();
    runSingleTest(transformer, messages);
  }

  // 正式测试
  const startTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    const transformer = createTransformer();
    const { duration, chunkCount } = runSingleTest(transformer, messages);
    durations.push(duration);
    totalChunks += chunkCount;

    // 进度显示
    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r   进度: ${i + 1}/${iterations}`);
    }
  }
  const totalTime = performance.now() - startTime;
  console.log(`\r   进度: ${iterations}/${iterations} ✓`);

  // 计算统计数据
  durations.sort((a, b) => a - b);
  const p50Index = Math.floor(iterations * 0.5);
  const p95Index = Math.floor(iterations * 0.95);
  const p99Index = Math.floor(iterations * 0.99);

  return {
    version,
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
    p50: durations[p50Index],
    p95: durations[p95Index],
    p99: durations[p99Index],
    minTime: durations[0],
    maxTime: durations[durations.length - 1],
    throughput: (totalChunks / totalTime) * 1000, // chunks per second
  };
}

/**
 * 格式化时间
 */
function formatTime(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  } else {
    return `${ms.toFixed(2)}ms`;
  }
}

/**
 * 打印结果
 */
function printResults(v1: BenchmarkResult, v2: BenchmarkResult) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 基准测试结果");
  console.log("=".repeat(80));

  console.log("\n📈 延迟统计：");
  console.log("┌─────────────┬──────────────┬──────────────┬──────────┐");
  console.log("│ 指标        │ V1 (旧版)    │ V2 (新版)    │ 差异     │");
  console.log("├─────────────┼──────────────┼──────────────┼──────────┤");

  const metrics = [
    { name: "平均延迟", key: "avgTime" as const },
    { name: "P50 延迟", key: "p50" as const },
    { name: "P95 延迟", key: "p95" as const },
    { name: "P99 延迟", key: "p99" as const },
    { name: "最小延迟", key: "minTime" as const },
    { name: "最大延迟", key: "maxTime" as const },
  ];

  for (const metric of metrics) {
    const v1Value = v1[metric.key];
    const v2Value = v2[metric.key];
    const diff = ((v2Value - v1Value) / v1Value) * 100;
    const diffStr =
      diff > 0
        ? `+${diff.toFixed(1)}%`
        : diff < 0
          ? `${diff.toFixed(1)}%`
          : "0%";

    const icon =
      Math.abs(diff) < 5
        ? "✅"
        : diff > 0
          ? "⚠️"
          : "🎉";

    console.log(
      `│ ${metric.name.padEnd(11)} │ ${formatTime(v1Value).padEnd(12)} │ ${formatTime(v2Value).padEnd(12)} │ ${icon} ${diffStr.padEnd(7)}│`,
    );
  }
  console.log("└─────────────┴──────────────┴──────────────┴──────────┘");

  console.log("\n⚡ 吞吐量：");
  console.log(`   V1: ${v1.throughput.toFixed(0)} chunks/s`);
  console.log(`   V2: ${v2.throughput.toFixed(0)} chunks/s`);
  const throughputDiff =
    ((v2.throughput - v1.throughput) / v1.throughput) * 100;
  console.log(
    `   差异: ${throughputDiff > 0 ? "+" : ""}${throughputDiff.toFixed(1)}%`,
  );

  console.log("\n⏱️  总执行时间：");
  console.log(`   V1: ${(v1.totalTime / 1000).toFixed(2)}s`);
  console.log(`   V2: ${(v2.totalTime / 1000).toFixed(2)}s`);

  console.log("\n" + "=".repeat(80));

  // 评估结果
  const p99Diff = ((v2.p99 - v1.p99) / v1.p99) * 100;
  if (p99Diff < 5) {
    console.log("✅ 性能测试通过！P99 延迟增长在可接受范围内 (<5%)");
  } else if (p99Diff < 10) {
    console.log(
      "⚠️  性能有轻微下降，P99 延迟增长 " +
        p99Diff.toFixed(1) +
        "%，建议进一步优化",
    );
  } else {
    console.log(
      "❌ 性能测试未通过！P99 延迟增长 " +
        p99Diff.toFixed(1) +
        "% (>10%)，需要优化",
    );
  }

  console.log("=".repeat(80) + "\n");
}

/**
 * 内存使用测试
 */
function testMemoryUsage(
  version: string,
  createTransformer: typeof createTransformerV1,
  messages: any[],
) {
  console.log(`\n💾 测试 ${version} 内存使用`);

  // 强制 GC（如果可用）
  if (global.gc) {
    global.gc();
  }

  const memBefore = process.memoryUsage();

  // 创建多个 transformer 实例
  const transformers = [];
  for (let i = 0; i < 100; i++) {
    transformers.push(createTransformer());
  }

  // 运行测试
  for (const transformer of transformers) {
    for (const msg of messages) {
      for (const chunk of transformer(msg)) {
        void chunk;
      }
    }
  }

  const memAfter = process.memoryUsage();

  console.log(`   堆使用前: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   堆使用后: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(
    `   增长: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`,
  );
}

/**
 * 主函数
 */
async function main() {
  console.log("🚀 Transform 性能基准测试\n");

  const testData = loadTestData();
  console.log(`📝 测试数据: ${testData.length} 条消息`);

  // 运行基准测试
  const iterations = process.env.BENCHMARK_ITERATIONS
    ? Number(process.env.BENCHMARK_ITERATIONS)
    : 1000;

  const v1Result = runBenchmark("V1 (旧版)", createTransformerV1, testData, iterations);
  const v2Result = runBenchmark("V2 (新版)", createTransformerV2, testData, iterations);

  // 打印结果
  printResults(v1Result, v2Result);

  // 内存测试
  testMemoryUsage("V1", createTransformerV1, testData);
  testMemoryUsage("V2", createTransformerV2, testData);

  console.log("\n💡 提示：");
  console.log("   - 使用真实 SDK 消息获得更准确的结果");
  console.log("   - 增加迭代次数：BENCHMARK_ITERATIONS=10000 bun run ...");
  console.log("   - 运行前执行 GC：node --expose-gc scripts/benchmark-transform.ts");
}

main();
