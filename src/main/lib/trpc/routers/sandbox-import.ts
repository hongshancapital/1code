import { z } from "zod";
import { router, publicProcedure } from "../index";
import { getDatabase } from "../../db";
import { chats, subChats, projects } from "../../db/schema";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { getBaseUrl } from "../../../index";
import { createWorktreeForChat } from "../../git/worktree";
import { importSandboxToWorktree, type ExportClaudeSession } from "../../git/sandbox-import";
import { getGitRemoteInfo } from "../../git";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "../../logger"

const writeClaudeSessionLog = createLogger("writeClaudeSession")
const openLocallyLog = createLogger("OPEN-LOCALLY")
const sandboxImportLog = createLogger("sandbox-import")


const execAsync = promisify(exec);

/**
 * Schema for remote chat data from web API
 */
const remoteSubChatSchema = z.object({
	id: z.string(),
	name: z.string(),
	mode: z.string(),
	messages: z.any(), // JSON messages array
	createdAt: z.string(),
	updatedAt: z.string(),
});

const remoteChatSchema = z.object({
	id: z.string(),
	name: z.string(),
	sandboxId: z.string().nullable(),
	meta: z
		.object({
			repository: z.string().optional(),
			branch: z.string().nullable().optional(),
		})
		.nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	subChats: z.array(remoteSubChatSchema),
});

/**
 * Write Claude session files to the isolated config directory for a subChat
 * This allows conversations to be resumed after importing from sandbox
 */
async function writeClaudeSession(
	subChatId: string,
	localProjectPath: string,
	session: ExportClaudeSession,
): Promise<void> {
	// Desktop's isolated config dir for this subChat (same as claude.ts uses)
	const isolatedConfigDir = join(
		app.getPath("userData"),
		"claude-sessions",
		subChatId
	);

	// Sanitize local path (same logic as Claude SDK)
	// SDK replaces both "/" and "." with "-"
	// /Users/sergey/.myapp → -Users-sergey--myapp
	const sanitizedPath = localProjectPath.replace(/[/.]/g, "-");
	const projectDir = join(isolatedConfigDir, "projects", sanitizedPath);

	writeClaudeSessionLog.info(`========== DEBUG ==========`);
	writeClaudeSessionLog.info(`subChatId: ${subChatId}`);
	writeClaudeSessionLog.info(`localProjectPath: ${localProjectPath}`);
	writeClaudeSessionLog.info(`sanitizedPath: ${sanitizedPath}`);
	writeClaudeSessionLog.info(`isolatedConfigDir: ${isolatedConfigDir}`);
	writeClaudeSessionLog.info(`projectDir: ${projectDir}`);
	writeClaudeSessionLog.info(`sessionId: ${session.sessionId}`);

	await mkdir(projectDir, { recursive: true });

	// Rewrite paths in session data: /home/user/repo → local path
	const rewrittenData = session.data.replace(/\/home\/user\/repo/g, localProjectPath);

	// Write session JSONL file
	const sessionFilePath = join(projectDir, `${session.sessionId}.jsonl`);
	await writeFile(sessionFilePath, rewrittenData, "utf-8");

	writeClaudeSessionLog.info(`Wrote session file: ${sessionFilePath}`);

	// Write sessions-index.json (with fallbacks for empty metadata)
	const indexData = {
		version: 1,
		entries: [{
			sessionId: session.sessionId,
			fullPath: sessionFilePath,
			projectPath: localProjectPath,
			firstPrompt: session.metadata?.firstPrompt || "",
			messageCount: session.metadata?.messageCount || 0,
			created: session.metadata?.created || new Date().toISOString(),
			modified: session.metadata?.modified || new Date().toISOString(),
			gitBranch: session.metadata?.gitBranch || "",
			fileMtime: Date.now(),
			isSidechain: false,
		}],
	};

	const indexPath = join(projectDir, "sessions-index.json");
	await writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf-8");

	writeClaudeSessionLog.info(`Wrote index file: ${indexPath}`);
	writeClaudeSessionLog.info(`========== END DEBUG ==========`);
}

export const sandboxImportRouter = router({
	/**
	 * Import a sandbox chat to a local worktree
	 */
	importSandboxChat: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				remoteChatId: z.string(),
				remoteSubChatId: z.string().optional(),
				projectId: z.string(),
				chatName: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const db = getDatabase();
			const apiUrl = getBaseUrl();
			if (!apiUrl) {
				throw new Error("API URL not configured");
			}

			openLocallyLog.info(`Starting import: remoteChatId=${input.remoteChatId}, remoteSubChatId=${input.remoteSubChatId || "all"}, sandboxId=${input.sandboxId}`);

			// Auth removed - sandbox import requires manual token or alternative auth
			const token: string | null = null;
			if (!token) {
				throw new Error("Sandbox import not available - auth manager removed");
			}

			// Verify project exists
			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, input.projectId))
				.get();

			if (!project) {
				throw new Error("Project not found");
			}

			// Fetch remote chat data (filter by subChatId if provided)
			const chatExportUrl = input.remoteSubChatId
				? `${apiUrl}/api/agents/chat/${input.remoteChatId}/export?subChatId=${input.remoteSubChatId}`
				: `${apiUrl}/api/agents/chat/${input.remoteChatId}/export`;
			openLocallyLog.info(`Fetching chat data from: ${chatExportUrl}`);

			const chatResponse = await fetch(chatExportUrl, {
				method: "GET",
				headers: {
					"X-Desktop-Token": token,
				},
			});

			if (!chatResponse.ok) {
				throw new Error(`Failed to fetch chat data: ${chatResponse.statusText}`);
			}

			const remoteChatData = remoteChatSchema.parse(await chatResponse.json());
			openLocallyLog.info(`Found ${remoteChatData.subChats.length} subchat(s) to import`);

			// Extract sessionId from the target subchat's messages BEFORE calling sandbox export
			// This allows us to request only the specific session from the sandbox
			let targetSessionId: string | undefined;
			if (remoteChatData.subChats.length > 0) {
				const targetSubChat = remoteChatData.subChats[0]; // First one (only one if filtered by subChatId)
				const messagesArray = targetSubChat.messages || [];
				const lastAssistant = [...messagesArray].reverse().find(
					(m: any) => m.role === "assistant"
				);
				targetSessionId = lastAssistant?.metadata?.sessionId;
				openLocallyLog.info(`Target sessionId from subchat messages: ${targetSessionId || "none"}`);
			}

			// Create worktree for the chat
			const worktreeResult = await createWorktreeForChat(
				project.path,
				input.projectId,
				`imported-${Date.now()}`, // Unique ID for worktree directory
			);

			if (!worktreeResult.success || !worktreeResult.worktreePath) {
				throw new Error(worktreeResult.error || "Failed to create worktree");
			}

			// Import sandbox git state to worktree (pass sessionId to get only that session)
			const importResult = await importSandboxToWorktree(
				worktreeResult.worktreePath,
				apiUrl,
				input.sandboxId,
				token,
				false, // fullExport = false
				targetSessionId, // sessionId to filter
			);
			openLocallyLog.info(`Received ${importResult.claudeSessions?.length || 0} Claude session(s) from sandbox`);

			if (!importResult.success) {
				writeClaudeSessionLog.warn(
					`[sandbox-import] Git state import failed: ${importResult.error}`,
				);
				// Continue anyway - chat history is still valuable
			}

			// Create local chat record
			const chat = db
				.insert(chats)
				.values({
					name: input.chatName || remoteChatData.name || "Imported Chat",
					projectId: input.projectId,
					worktreePath: worktreeResult.worktreePath,
					branch: worktreeResult.branch,
					baseBranch: worktreeResult.baseBranch,
				})
				.returning()
				.get();

			// Import sub-chats with messages and Claude sessions
			const claudeSessions = importResult.claudeSessions || [];
			sandboxImportLog.info(`Available Claude sessions: ${claudeSessions.length}`);

			for (const remoteSubChat of remoteChatData.subChats) {
				const messagesArray = remoteSubChat.messages || [];

				// Find sessionId from last assistant message BEFORE creating subChat
				const lastAssistant = [...messagesArray].reverse().find(
					(m: any) => m.role === "assistant"
				);
				const messageSessionId = lastAssistant?.metadata?.sessionId;

				// Check if we have a matching Claude session
				const matchingSession = messageSessionId && claudeSessions.length > 0
					? claudeSessions.find(s => s.sessionId === messageSessionId)
					: undefined;

				// Create subChat with sessionId if we have a matching session
				const createdSubChat = db.insert(subChats)
					.values({
						chatId: chat.id,
						name: remoteSubChat.name,
						mode: remoteSubChat.mode === "plan" ? "plan" : "agent",
						messages: JSON.stringify(messagesArray),
						// Set sessionId if we have matching Claude session (enables resume)
						...(matchingSession && { sessionId: messageSessionId }),
					})
					.returning()
					.get();

				// Write Claude session files if we have a matching one
				if (matchingSession) {
					try {
						await writeClaudeSession(
							createdSubChat.id,
							worktreeResult.worktreePath!,
							matchingSession,
						);
						sandboxImportLog.info(`Wrote Claude session for subChat ${createdSubChat.id} with sessionId ${messageSessionId}`);
					} catch (sessionErr) {
						sandboxImportLog.error(`Failed to write Claude session:`, sessionErr);
					}
				}
			}

			// If no sub-chats were imported, create an empty one
			const importedSubChats = db
				.select()
				.from(subChats)
				.where(eq(subChats.chatId, chat.id))
				.all();

			if (importedSubChats.length === 0) {
				db.insert(subChats)
					.values({
						chatId: chat.id,
						name: "Main",
						mode: "agent",
						messages: "[]",
					})
					.run();
			}

			return {
				success: true,
				chatId: chat.id,
				worktreePath: worktreeResult.worktreePath,
				gitImportSuccess: importResult.success,
				gitImportError: importResult.error,
			};
		}),

	/**
	 * Get list of user's remote sandbox chats
	 */
	listRemoteSandboxChats: publicProcedure
		.input(
			z.object({
				teamId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const apiUrl = getBaseUrl();

			// Auth removed - sandbox import requires manual token or alternative auth
			const token: string | null = null;
			if (!token) {
				throw new Error("Sandbox list not available - auth manager removed");
			}

			// Call web API to get sandbox chats
			// Note: This would need a corresponding endpoint on the web side
			const response = await fetch(
				`${apiUrl}/api/agents/chats?teamId=${input.teamId}`,
				{
					method: "GET",
					headers: {
						"X-Desktop-Token": token,
					},
				},
			);

			if (!response.ok) {
				throw new Error(`Failed to fetch sandbox chats: ${response.statusText}`);
			}

			return response.json();
		}),

	/**
	 * Clone a repository from sandbox and import the chat
	 * This is for cases when user doesn't have the repo locally
	 */
	cloneFromSandbox: publicProcedure
		.input(
			z.object({
				sandboxId: z.string(),
				remoteChatId: z.string(),
				remoteSubChatId: z.string().optional(),
				chatName: z.string().optional(),
				targetPath: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			openLocallyLog.info(`Starting clone process`);
			openLocallyLog.info(`Input:`, {
				sandboxId: input.sandboxId,
				remoteChatId: input.remoteChatId,
				remoteSubChatId: input.remoteSubChatId || "all",
				chatName: input.chatName,
				targetPath: input.targetPath,
			});

			const db = getDatabase();
			const apiUrl = getBaseUrl();
			if (!apiUrl) {
				throw new Error("API URL not configured");
			}
			openLocallyLog.info(`API URL: ${apiUrl}`);

			// Auth removed - sandbox clone requires manual token or alternative auth
			openLocallyLog.info(`Auth manager removed - sandbox clone not available`);
			const token: string | null = null;
			if (!token) {
				openLocallyLog.error(`No auth token available`);
				throw new Error("Sandbox clone not available - auth manager removed");
			}
			openLocallyLog.info(`Auth token obtained`);

			// Fetch remote chat data first (filter by subChatId if provided)
			const chatExportUrl = input.remoteSubChatId
				? `${apiUrl}/api/agents/chat/${input.remoteChatId}/export?subChatId=${input.remoteSubChatId}`
				: `${apiUrl}/api/agents/chat/${input.remoteChatId}/export`;
			openLocallyLog.info(`Fetching chat data from: ${chatExportUrl}`);
			const chatResponse = await fetch(chatExportUrl, {
				method: "GET",
				headers: {
					"X-Desktop-Token": token,
				},
			});

			if (!chatResponse.ok) {
				openLocallyLog.error(`Failed to fetch chat data: ${chatResponse.status} ${chatResponse.statusText}`);
				throw new Error(`Failed to fetch chat data: ${chatResponse.statusText}`);
			}

			const chatJson = await chatResponse.json();
			openLocallyLog.info(`Remote chat data received:`, {
				id: chatJson.id,
				name: chatJson.name,
				sandboxId: chatJson.sandboxId,
				meta: chatJson.meta,
				subChatsCount: chatJson.subChats?.length,
			});

			const remoteChatData = remoteChatSchema.parse(chatJson);
			openLocallyLog.info(`Found ${remoteChatData.subChats.length} subchat(s) to import`);

			// Extract sessionId from the target subchat's messages BEFORE calling sandbox export
			let targetSessionId: string | undefined;
			if (remoteChatData.subChats.length > 0) {
				const targetSubChat = remoteChatData.subChats[0]; // First one (only one if filtered by subChatId)
				const messagesArray = targetSubChat.messages || [];
				const lastAssistant = [...messagesArray].reverse().find(
					(m: any) => m.role === "assistant"
				);
				targetSessionId = lastAssistant?.metadata?.sessionId;
				openLocallyLog.info(`Target sessionId from subchat messages: ${targetSessionId || "none"}`);
			}

			// DEBUG: Fetch sandbox debug info to see what Claude sessions exist
			try {
				const debugUrl = `${apiUrl}/api/agents/sandbox/${input.sandboxId}/export/debug`;
				openLocallyLog.info(`Fetching debug info from: ${debugUrl}`);
				const debugResponse = await fetch(debugUrl, {
					method: "GET",
					headers: { "X-Desktop-Token": token },
				});
				if (debugResponse.ok) {
					const debugData = await debugResponse.json();
					openLocallyLog.info(`========== SANDBOX DEBUG INFO ==========`);
					openLocallyLog.info(`Paths:`, debugData.paths);
					openLocallyLog.info(`Checks:`, debugData.checks);
					openLocallyLog.info(`Files in .claude:`, debugData.files?.claudeHome);
					openLocallyLog.info(`Projects dirs:`, debugData.files?.projects);
					openLocallyLog.info(`Project dir contents:`, debugData.files?.projectDir);
					openLocallyLog.info(`Sessions index:`, debugData.sessionsIndex);
					openLocallyLog.info(`Session files exist:`, debugData.sessionFilesExist);
					openLocallyLog.info(`Errors:`, debugData.errors);
					openLocallyLog.info(`========== END SANDBOX DEBUG ==========`);
				} else {
					openLocallyLog.info(`Debug endpoint returned ${debugResponse.status}`);
				}
			} catch (debugErr) {
				openLocallyLog.info(`Debug fetch failed:`, debugErr);
			}

			// Create target directory
			openLocallyLog.info(`Creating target directory: ${input.targetPath}`);
			await mkdir(input.targetPath, { recursive: true });
			openLocallyLog.info(`Target directory created`);

			// Initialize git repo
			openLocallyLog.info(`Initializing git repo...`);
			await execAsync("git init", { cwd: input.targetPath });
			openLocallyLog.info(`Git repo initialized`);

			// Import sandbox git state with FULL export (includes entire repo history)
			// Pass sessionId to get only that specific session
			openLocallyLog.info(`Starting sandbox import with full export, sessionId: ${targetSessionId || "all"}`);
			const importResult = await importSandboxToWorktree(
				input.targetPath,
				apiUrl,
				input.sandboxId,
				token,
				true, // fullExport = true for cloning
				targetSessionId, // sessionId to filter
			);

			openLocallyLog.info(`Import result:`, {
				success: importResult.success,
				error: importResult.error,
				claudeSessionsCount: importResult.claudeSessions?.length || 0,
			});

			if (!importResult.success) {
				writeClaudeSessionLog.warn(
					`[OPEN-LOCALLY] Git state import failed: ${importResult.error}`,
				);
				// Continue anyway - we can still use the directory
			}

			// Get git remote info (should have been set from the bundle)
			openLocallyLog.info(`Getting git remote info...`);
			const gitInfo = await getGitRemoteInfo(input.targetPath);
			openLocallyLog.info(`Git remote info:`, gitInfo);

			// Fallback: extract owner/repo from remote chat metadata if git remote wasn't set up
			// This happens when E2B export doesn't include remoteUrl in the meta
			let finalOwner = gitInfo.owner;
			let finalRepo = gitInfo.repo;
			let finalRemoteUrl = gitInfo.remoteUrl;
			let finalProvider = gitInfo.provider;

			if (!finalOwner || !finalRepo) {
				const repoFromMeta = remoteChatData.meta?.repository;
				if (repoFromMeta) {
					const [metaOwner, metaRepo] = repoFromMeta.split("/");
					if (metaOwner && metaRepo) {
						openLocallyLog.info(`Git remote missing, using meta.repository: ${repoFromMeta}`);
						finalOwner = metaOwner;
						finalRepo = metaRepo;
						finalProvider = "github"; // Assume GitHub for now
						finalRemoteUrl = `https://github.com/${metaOwner}/${metaRepo}`;

						// Actually set up the git remote so repo is properly configured
						try {
							await execAsync(`git remote add origin ${finalRemoteUrl}`, { cwd: input.targetPath });
							openLocallyLog.info(`Added origin remote: ${finalRemoteUrl}`);
						} catch {
							// Remote might already exist, try to update it
							try {
								await execAsync(`git remote set-url origin ${finalRemoteUrl}`, { cwd: input.targetPath });
								openLocallyLog.info(`Updated origin remote: ${finalRemoteUrl}`);
							} catch {
								openLocallyLog.warn(`Could not set origin remote`);
							}
						}
					}
				}
			}

			openLocallyLog.info(`Final git info: owner="${finalOwner}", repo="${finalRepo}"`);

			// Get the actual current branch from git
			openLocallyLog.info(`Getting current branch from git...`);
			let actualBranch = remoteChatData.meta?.branch || "main"; // fallback
			try {
				const { stdout: currentBranch } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: input.targetPath });
				actualBranch = currentBranch.trim();
				openLocallyLog.info(`Actual git branch: ${actualBranch}`);
			} catch (err) {
				openLocallyLog.warn(`Could not get current branch, using fallback: ${actualBranch}`, err);
			}

			// Check if project already exists (from a previous failed attempt)
			openLocallyLog.info(`Checking for existing project at path: ${input.targetPath}`);
			const existingProject = db
				.select()
				.from(projects)
				.where(eq(projects.path, input.targetPath))
				.get();

			openLocallyLog.info(`Existing project:`, existingProject ? { id: existingProject.id, name: existingProject.name } : null);

			// Use existing project or create new one
			const project = existingProject
				? db
						.update(projects)
						.set({
							updatedAt: new Date(),
							gitRemoteUrl: finalRemoteUrl,
							gitProvider: finalProvider,
							gitOwner: finalOwner,
							gitRepo: finalRepo,
						})
						.where(eq(projects.id, existingProject.id))
						.returning()
						.get()!
				: db
						.insert(projects)
						.values({
							name: basename(input.targetPath),
							path: input.targetPath,
							gitRemoteUrl: finalRemoteUrl,
							gitProvider: finalProvider,
							gitOwner: finalOwner,
							gitRepo: finalRepo,
						})
						.returning()
						.get();

			openLocallyLog.info(`Project created/updated:`, { id: project.id, name: project.name });

			// Create chat record (using the project path directly, no separate worktree needed
			// since this is a fresh clone)
			openLocallyLog.info(`Creating chat record with branch: ${actualBranch}`);
			const chat = db
				.insert(chats)
				.values({
					name: input.chatName || remoteChatData.name || "Imported Chat",
					projectId: project.id,
					worktreePath: input.targetPath,
					branch: actualBranch,
					baseBranch: "main",
				})
				.returning()
				.get();

			openLocallyLog.info(`Chat created:`, { id: chat.id, name: chat.name });

			// Import sub-chats with messages and Claude sessions
			openLocallyLog.info(`Importing ${remoteChatData.subChats.length} sub-chats...`);
			const claudeSessions = importResult.claudeSessions || [];
			openLocallyLog.info(`Available Claude sessions: ${claudeSessions.length}`);

			for (const remoteSubChat of remoteChatData.subChats) {
				const messagesArray = remoteSubChat.messages || [];
				const messagesCount = Array.isArray(messagesArray) ? messagesArray.length : 0;
				openLocallyLog.info(`Importing sub-chat: ${remoteSubChat.name} (mode: ${remoteSubChat.mode}, messages: ${messagesCount})`);
				openLocallyLog.info(`Messages preview:`, JSON.stringify(messagesArray).slice(0, 500));

				// Find sessionId from last assistant message BEFORE creating subChat
				const lastAssistant = [...messagesArray].reverse().find(
					(m: any) => m.role === "assistant"
				);
				const messageSessionId = lastAssistant?.metadata?.sessionId;

				// Check if we have a matching Claude session
				const matchingSession = messageSessionId && claudeSessions.length > 0
					? claudeSessions.find(s => s.sessionId === messageSessionId)
					: undefined;

				// Create subChat with sessionId if we have a matching session
				const createdSubChat = db.insert(subChats)
					.values({
						chatId: chat.id,
						name: remoteSubChat.name,
						mode: remoteSubChat.mode === "plan" ? "plan" : "agent",
						messages: JSON.stringify(messagesArray),
						// Set sessionId if we have matching Claude session (enables resume)
						...(matchingSession && { sessionId: messageSessionId }),
					})
					.returning()
					.get();

				// Write Claude session files if we have a matching one
				if (matchingSession) {
					try {
						await writeClaudeSession(
							createdSubChat.id,
							input.targetPath,
							matchingSession,
						);
						openLocallyLog.info(`Wrote Claude session for subChat ${createdSubChat.id} with sessionId ${messageSessionId}`);
					} catch (sessionErr) {
						openLocallyLog.error(`Failed to write Claude session:`, sessionErr);
					}
				} else if (messageSessionId) {
					openLocallyLog.info(`No matching Claude session found for sessionId: ${messageSessionId.slice(0, 8)}...`);
				} else {
					openLocallyLog.info(`No sessionId in messages or no sessions exported`);
				}
			}

			// If no sub-chats were imported, create an empty one
			const importedSubChats = db
				.select()
				.from(subChats)
				.where(eq(subChats.chatId, chat.id))
				.all();

			if (importedSubChats.length === 0) {
				openLocallyLog.info(`No sub-chats imported, creating default`);
				db.insert(subChats)
					.values({
						chatId: chat.id,
						name: "Main",
						mode: "agent",
						messages: "[]",
					})
					.run();
			}

			openLocallyLog.info(`Clone completed successfully!`);
			openLocallyLog.info(`Final result:`, {
				projectId: project.id,
				chatId: chat.id,
				gitImportSuccess: importResult.success,
				gitImportError: importResult.error,
			});

			return {
				success: true,
				projectId: project.id,
				chatId: chat.id,
				gitImportSuccess: importResult.success,
				gitImportError: importResult.error,
			};
		}),
});
