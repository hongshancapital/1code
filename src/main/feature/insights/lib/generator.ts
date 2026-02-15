/**
 * Insight 报告生成器
 * 使用 Claude Agent SDK 生成 Markdown 格式的使用报告
 * Agent 可以读取导出的数据文件来获取更详细的信息
 */

import { eq } from "drizzle-orm";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { getDatabase, insights } from "../db";
import { getBundledClaudeBinaryPath, buildClaudeEnv } from "../claude";
import type { InsightStats, ReportType } from "./types";

/**
 * 认证配置类型（与 insights.ts 保持一致）
 */
export interface AuthConfig {
  type: "oauth" | "litellm" | "apikey" | "custom";
  token?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * 构建个性化的 Agent 系统提示
 * @param userName 用户名称
 * @param language 语言设置 (zh/en)
 * @param personalPreferences 用户个人偏好
 */
export function buildAgentSystemPrompt(
  userName?: string,
  language: string = "zh",
  personalPreferences?: string,
): string {
  const isZh = language === "zh" || language.startsWith("zh");
  const greeting = userName
    ? isZh
      ? `${userName}`
      : userName
    : isZh
      ? "朋友"
      : "friend";

  const userContext = personalPreferences
    ? isZh
      ? `\n用户偏好：${personalPreferences}`
      : `\nUser preferences: ${personalPreferences}`
    : "";

  if (isZh) {
    return `你是${greeting}的 AI 工作伙伴，像一位贴心的同事和导师。你的任务是回顾${greeting}这段时间的工作，给予温暖的鼓励和真诚的建议。
${userContext}
## 你可以读取的数据

当前工作目录下有以下文件：
- stats.json: 统计数据摘要
- index.json: 报告元数据和项目列表
- chats/*.json: 按项目分组的聊天记录（包含具体工作内容）

**重要**：请仔细阅读 chats/ 目录下的聊天记录文件，了解用户具体做了什么工作、解决了什么问题、创建了什么功能。这些具体内容是报告的核心。

## 输出格式

你的输出必须包含两部分，用分隔符严格分开：

===SUMMARY===
一段温暖的 1-2 句话总结，像朋友一样和${greeting}打招呼，提到他做得好的地方。
不要提及 token、费用等技术细节。直接概括工作成果。
例如："嘿，这两天你在用户认证模块上取得了不错的进展！登录流程优化得很棒。"

===DETAIL===
一份 HTML 格式的详细报告，包含：

<div class="insight-report">
  <section class="highlight">
    <h2>🌟 ${greeting}的亮点</h2>
    <p>具体描述用户完成的工作成果，要引用聊天记录中的实际内容</p>
  </section>

  <section class="work-summary">
    <h2>📝 工作回顾</h2>
    <ul>
      <li>项目1：做了什么（具体功能/修复）</li>
      <li>项目2：做了什么</li>
    </ul>
  </section>

  <section class="encouragement">
    <h2>💪 继续加油</h2>
    <p>基于用户的工作内容，给出 1-2 条温暖的鼓励和可操作的建议</p>
  </section>

  <section class="next-steps">
    <h2>🎯 接下来可以关注</h2>
    <p>基于聊天记录中观察到的未完成事项或可改进点</p>
  </section>
</div>

## 风格要求

1. **温暖亲切**：像朋友聊天，不要用"您"，用"你"
2. **具体有力**：引用实际工作内容，不说空话
3. **鼓励为主**：肯定成果，建议委婉
4. **避免冷数据**：不要强调 token 数量、API 调用次数、费用等
5. **语言**：必须使用中文输出`;
  } else {
    return `You are ${greeting}'s AI work companion, like a thoughtful colleague and mentor. Your task is to review ${greeting}'s recent work and provide warm encouragement and genuine suggestions.
${userContext}
## Data You Can Access

The current working directory contains:
- stats.json: Statistics summary
- index.json: Report metadata and project list
- chats/*.json: Chat records grouped by project (containing specific work content)

**Important**: Please carefully read the chat files in the chats/ directory to understand what specific work the user did, what problems they solved, and what features they created. This specific content is the core of your report.

## Output Format

Your output must contain two parts, strictly separated:

===SUMMARY===
A warm 1-2 sentence summary, greeting ${greeting} like a friend, mentioning what they did well.
Don't mention tokens, costs, or other technical details. Directly summarize work achievements.
Example: "Hey, you made great progress on the user authentication module these past days! The login flow optimization looks fantastic."

===DETAIL===
A detailed HTML report containing:

<div class="insight-report">
  <section class="highlight">
    <h2>🌟 ${greeting}'s Highlights</h2>
    <p>Specifically describe the user's work achievements, referencing actual content from chat records</p>
  </section>

  <section class="work-summary">
    <h2>📝 Work Review</h2>
    <ul>
      <li>Project 1: What was done (specific features/fixes)</li>
      <li>Project 2: What was done</li>
    </ul>
  </section>

  <section class="encouragement">
    <h2>💪 Keep Going</h2>
    <p>Based on the user's work content, give 1-2 warm encouragements and actionable suggestions</p>
  </section>

  <section class="next-steps">
    <h2>🎯 What to Focus on Next</h2>
    <p>Based on incomplete items or improvement points observed in chat records</p>
  </section>
</div>

## Style Requirements

1. **Warm and friendly**: Like chatting with a friend
2. **Specific and powerful**: Reference actual work content, no empty words
3. **Encouragement first**: Affirm achievements, give gentle suggestions
4. **Avoid cold data**: Don't emphasize token counts, API calls, costs, etc.
5. **Language**: Must output in English`;
  }
}

/**
 * 用户配置类型
 */
export interface UserConfig {
  preferredName?: string;
  personalPreferences?: string;
  language?: string; // "zh" | "en" | "system"
}

/**
 * 构建报告生成的用户提示
 */
function buildPrompt(
  stats: InsightStats,
  reportType: ReportType,
  language: string = "zh",
): string {
  const isZh = language === "zh" || language.startsWith("zh");

  if (isZh) {
    const period = reportType === "daily" ? "昨天" : "上周";
    return `请回顾我${period}的工作，生成一份温暖的工作报告。

首先，请读取当前目录下的文件：
1. 先读 index.json 了解有哪些项目
2. 然后读取 chats/ 目录下的聊天记录文件，了解我具体做了什么

时间范围: ${stats.period.start} 至 ${stats.period.end}

请按照系统提示的格式输出，包含 ===SUMMARY=== 和 ===DETAIL=== 两部分。
记住：重点是我做了什么工作、取得了什么成果，而不是使用了多少 token。`;
  } else {
    const period = reportType === "daily" ? "yesterday" : "last week";
    return `Please review my work from ${period} and generate a warm work report.

First, read the files in the current directory:
1. Read index.json to see what projects there are
2. Then read the chat files in the chats/ directory to understand what I specifically did

Time range: ${stats.period.start} to ${stats.period.end}

Please output according to the format in the system prompt, including ===SUMMARY=== and ===DETAIL=== sections.
Remember: Focus on what work I did and what I achieved, not how many tokens I used.`;
  }
}

/**
 * 更新进度信息到数据库
 * 使用 error 字段临时存储进度（JSON 格式）
 */
function updateProgress(
  db: ReturnType<typeof getDatabase>,
  reportId: string,
  progress: {
    step: string;
    detail?: string;
    toolCalls?: string[];
  },
) {
  db.update(insights)
    .set({
      error: JSON.stringify(progress),
      updatedAt: new Date(),
    })
    .where(eq(insights.id, reportId))
    .run();
}

/**
 * 从 Agent 消息中提取工具调用信息
 */
function extractToolInfo(msg: any): string | null {
  // 处理 tool_use
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        const toolName = block.name || "unknown";
        const input = block.input || {};
        // 提取文件路径等关键信息
        if (input.file_path) {
          return `${toolName}: ${input.file_path}`;
        }
        if (input.path) {
          return `${toolName}: ${input.path}`;
        }
        if (input.command) {
          return `${toolName}: ${input.command.slice(0, 50)}...`;
        }
        return toolName;
      }
    }
  }

  // 处理 tool_result
  if (msg.type === "user" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "tool_result") {
        return null; // tool_result 不需要单独显示
      }
    }
  }

  return null;
}

/**
 * 解析 Agent 输出，提取 SUMMARY 和 DETAIL 部分
 */
function parseAgentOutput(output: string): { summary: string; detail: string } {
  const summaryMatch = output.match(
    /===SUMMARY===([\s\S]*?)(?:===DETAIL===|$)/,
  );
  const detailMatch = output.match(/===DETAIL===([\s\S]*)$/);

  const summary = summaryMatch?.[1]?.trim() || "";
  const detail = detailMatch?.[1]?.trim() || "";

  return { summary, detail };
}

/**
 * 使用 Claude Agent 生成 Insight 报告
 */
export async function generateInsightReport(
  reportId: string,
  authConfig: AuthConfig, // 认证配置（支持 OAuth、LiteLLM、API Key）
  userConfig?: UserConfig, // 用户配置（名称、偏好、语言）
): Promise<{ summary: string; reportHtml: string; reportMarkdown: string }> {
  const db = getDatabase();

  // 获取报告记录
  const report = db
    .select()
    .from(insights)
    .where(eq(insights.id, reportId))
    .get();

  if (!report) {
    throw new Error("Report not found");
  }

  if (!report.dataDir) {
    throw new Error("Report data directory not found");
  }

  // 注意：状态已在 router 中更新为 generating
  // 更新初始进度
  updateProgress(db, reportId, {
    step: "loading_sdk",
    detail: "正在加载 Claude SDK...",
  });

  try {
    const stats = JSON.parse(report.statsJson) as InsightStats;
    // 确定语言设置
    const language =
      userConfig?.language === "system"
        ? "zh" // 系统语言默认用中文
        : userConfig?.language || "zh";
    const prompt = buildPrompt(
      stats,
      report.reportType as ReportType,
      language,
    );

    // 构建个性化系统提示
    const systemPrompt = buildAgentSystemPrompt(
      userConfig?.preferredName,
      language,
      userConfig?.personalPreferences,
    );

    console.log("[Insights] Starting Agent generation in:", report.dataDir);
    console.log("[Insights] User config:", userConfig);

    // 更新进度：启动会话
    updateProgress(db, reportId, {
      step: "starting_session",
      detail: "正在启动 Agent 会话...",
    });

    // 构建环境变量（根据认证类型设置不同的环境变量）
    const customEnv: Record<string, string> = {};

    if (authConfig.type === "oauth") {
      // Claude Code OAuth 使用专用环境变量
      if (authConfig.token) {
        customEnv.CLAUDE_CODE_OAUTH_TOKEN = authConfig.token;
      }
      console.log("[Insights] Using OAuth auth");
    } else if (authConfig.type === "litellm" || authConfig.type === "custom") {
      // LiteLLM 和 Custom 都使用 ANTHROPIC_AUTH_TOKEN 和 ANTHROPIC_BASE_URL
      if (authConfig.token) {
        customEnv.ANTHROPIC_AUTH_TOKEN = authConfig.token;
      }
      if (authConfig.baseUrl) {
        customEnv.ANTHROPIC_BASE_URL = authConfig.baseUrl;
      }
      console.log(
        `[Insights] Using ${authConfig.type} auth, baseUrl:`,
        authConfig.baseUrl,
      );
    } else if (authConfig.type === "apikey") {
      // API Key 使用 ANTHROPIC_API_KEY
      if (authConfig.token) {
        customEnv.ANTHROPIC_API_KEY = authConfig.token;
      }
      if (authConfig.baseUrl) {
        customEnv.ANTHROPIC_BASE_URL = authConfig.baseUrl;
      }
      console.log("[Insights] Using API Key auth");
    }

    const claudeEnv = buildClaudeEnv({ customEnv });
    console.log("[Insights] Claude env built for auth type:", authConfig.type);

    // 启动 Agent 会话
    const queryOptions = {
      prompt,
      options: {
        cwd: report.dataDir, // 设置工作目录为数据导出目录
        systemPrompt, // 使用个性化系统提示
        env: claudeEnv,
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: getBundledClaudeBinaryPath(),
        // 限制 Agent 只能读取文件，不能执行其他操作
        maxTurns: 8, // 增加 turn 数以允许更多文件读取
      },
    };

    // 收集 Agent 输出
    let reportMarkdown = "";
    let hasError = false;
    let errorMessage = "";
    const toolCalls: string[] = [];
    let _turnCount = 0;

    for await (const msg of claudeQuery(queryOptions)) {
      // 提取工具调用信息
      const toolInfo = extractToolInfo(msg);
      if (toolInfo) {
        toolCalls.push(toolInfo);
        updateProgress(db, reportId, {
          step: "executing",
          detail: toolInfo,
          toolCalls: toolCalls.slice(-5), // 只保留最近 5 个
        });
        console.log("[Insights] Tool call:", toolInfo);
      }

      // 处理不同类型的消息
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            reportMarkdown += block.text;
            // 更新进度：正在生成
            if (
              reportMarkdown.length > 0 &&
              reportMarkdown.length % 500 < 100
            ) {
              updateProgress(db, reportId, {
                step: "generating",
                detail: `正在生成报告... (${reportMarkdown.length} 字符)`,
                toolCalls: toolCalls.slice(-5),
              });
            }
          }
        }
        _turnCount++;
      }

      // 处理 system init 消息
      if (msg.type === "system" && msg.subtype === "init") {
        updateProgress(db, reportId, {
          step: "agent_ready",
          detail: "Agent 已就绪，开始分析数据...",
        });
      }

      // 处理错误 — SDKResultMessage with error subtype
      if (msg.type === "result" && msg.subtype?.startsWith("error")) {
        hasError = true;
        errorMessage = msg.subtype || "Unknown error";
        console.error("[Insights] Agent error:", errorMessage);
      }
    }

    if (hasError && !reportMarkdown) {
      throw new Error(errorMessage || "Agent generation failed");
    }

    // 清理报告内容（移除可能的代码块标记）
    const fullOutput = reportMarkdown
      .replace(/^```markdown\n?/i, "")
      .replace(/^```html\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    if (!fullOutput) {
      throw new Error("Agent did not generate any content");
    }

    console.log(
      "[Insights] Agent generation completed, length:",
      fullOutput.length,
    );

    // 解析输出，提取 SUMMARY 和 DETAIL
    const { summary, detail } = parseAgentOutput(fullOutput);

    console.log("[Insights] Parsed - Summary:", summary.slice(0, 100), "...");
    console.log("[Insights] Parsed - Detail length:", detail.length);

    // 如果没有解析出格式化输出，fallback 到原始输出
    const finalSummary = summary || fullOutput.slice(0, 200);
    const finalDetail = detail || fullOutput;

    // 更新报告为完成状态（清除进度信息）
    db.update(insights)
      .set({
        summary: finalSummary,
        reportHtml: finalDetail,
        reportMarkdown: fullOutput, // 保留完整原始输出
        status: "completed",
        error: null, // 清除进度信息
        dataDir: null, // 清理数据目录引用
        updatedAt: new Date(),
      })
      .where(eq(insights.id, reportId))
      .run();

    return {
      summary: finalSummary,
      reportHtml: finalDetail,
      reportMarkdown: fullOutput,
    };
  } catch (error) {
    console.error("[Insights] Agent generation error:", error);

    // 更新为失败状态
    db.update(insights)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(insights.id, reportId))
      .run();

    throw error;
  }
}

