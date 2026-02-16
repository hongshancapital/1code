#!/bin/bash

# Langfuse Extension 测试脚本
# 用法：LANGFUSE_PUBLIC_KEY=pk-lf-xxx LANGFUSE_SECRET_KEY=sk-lf-xxx ./scripts/test-langfuse.sh

echo "=== Langfuse Extension 测试 ==="
echo ""

# 检查环境变量
if [ -z "$LANGFUSE_PUBLIC_KEY" ] || [ -z "$LANGFUSE_SECRET_KEY" ]; then
  echo "❌ 错误：缺少环境变量"
  echo ""
  echo "请设置以下环境变量："
  echo "  export LANGFUSE_PUBLIC_KEY=\"pk-lf-xxx\""
  echo "  export LANGFUSE_SECRET_KEY=\"sk-lf-xxx\""
  echo "  export LANGFUSE_HOST=\"https://cloud.langfuse.com\"  # 可选"
  echo ""
  echo "然后重新运行此脚本"
  exit 1
fi

echo "✅ 环境变量已配置"
echo "   PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:0:10}..."
echo "   SECRET_KEY: ${LANGFUSE_SECRET_KEY:0:10}..."
echo "   HOST: ${LANGFUSE_HOST:-https://cloud.langfuse.com (默认)}"
echo ""

# 验证编译
echo "📦 编译项目..."
if bun run build > /dev/null 2>&1; then
  echo "✅ 编译成功"
else
  echo "❌ 编译失败，请检查代码"
  exit 1
fi
echo ""

# 启动应用
echo "🚀 启动应用..."
echo ""
echo "接下来的步骤："
echo "1. 应用启动后，执行一次完整对话（包含工具调用）"
echo "2. 登录 Langfuse Dashboard: https://cloud.langfuse.com"
echo "3. 验证数据："
echo "   - Trace 列表中看到新会话"
echo "   - Generation 包含 token 统计、模型名、输入输出"
echo "   - Span 包含工具调用的输入输出"
echo ""
echo "按 Ctrl+C 停止应用"
echo ""

# 导出环境变量并启动
export LANGFUSE_PUBLIC_KEY
export LANGFUSE_SECRET_KEY
export LANGFUSE_HOST

bun run dev
