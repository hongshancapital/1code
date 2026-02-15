import { execFile } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { createLogger } from "../logger"

const sandboxImportLog = createLogger("sandbox-import")
const openLocallyLog = createLogger("OPEN-LOCALLY")


const execFileAsync = promisify(execFile);

/**
 * Types for sandbox export NDJSON stream
 */
export interface ExportMeta {
	type: "meta";
	branch: string;
	baseCommit: string;
	headCommit: string;
	baseRef: string;
	isFullExport?: boolean;
	remoteUrl?: string;
}

export interface ExportBundle {
	type: "bundle";
	data: string | null; // base64 encoded
}

export interface ExportPatch {
	type: "staged_patch" | "unstaged_patch";
	data: string | null;
}

export interface ExportUntracked {
	type: "untracked";
	path: string;
	data: string; // base64 encoded
}

export interface ExportDone {
	type: "done";
}

export interface ExportError {
	type: "error";
	error: string;
}

export interface ExportClaudeSession {
	type: "claude_session";
	sessionId: string;
	data: string; // Raw JSONL content
	metadata: {
		firstPrompt: string;
		messageCount: number;
		created: string;
		modified: string;
		gitBranch: string;
	};
}

export type ExportChunk =
	| ExportMeta
	| ExportBundle
	| ExportPatch
	| ExportUntracked
	| ExportClaudeSession
	| ExportDone
	| ExportError;

/**
 * Parsed export data from sandbox
 */
export interface SandboxExportData {
	meta: ExportMeta;
	bundle: Buffer | null;
	stagedPatch: string | null;
	unstagedPatch: string | null;
	untrackedFiles: Array<{ path: string; content: Buffer }>;
	claudeSessions: ExportClaudeSession[];
}

/**
 * Parse NDJSON export stream into structured data
 */
export async function parseExportStream(
	stream: ReadableStream<Uint8Array>,
): Promise<SandboxExportData> {
	sandboxImportLog.info(`parseExportStream starting...`);
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	let buffer = "";
	let chunkCount = 0;
	const result: SandboxExportData = {
		meta: null as unknown as ExportMeta,
		bundle: null,
		stagedPatch: null,
		unstagedPatch: null,
		untrackedFiles: [],
		claudeSessions: [],
	};

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			sandboxImportLog.info(`Stream finished, processed ${chunkCount} chunks`);
			break;
		}

		buffer += decoder.decode(value, { stream: true });

		// Process complete lines
		const lines = buffer.split("\n");
		buffer = lines.pop() || ""; // Keep incomplete line in buffer

		for (const line of lines) {
			if (!line.trim()) continue;

			const chunk = JSON.parse(line) as ExportChunk;
			chunkCount++;
			sandboxImportLog.info(`Received chunk ${chunkCount}: type=${chunk.type}`);

			switch (chunk.type) {
				case "meta":
					result.meta = chunk;
					sandboxImportLog.info(`Meta chunk:`, {
						branch: chunk.branch,
						baseCommit: chunk.baseCommit,
						headCommit: chunk.headCommit,
						isFullExport: chunk.isFullExport,
						remoteUrl: chunk.remoteUrl,
					});
					break;
				case "bundle":
					if (chunk.data) {
						result.bundle = Buffer.from(chunk.data, "base64");
						sandboxImportLog.info(`Bundle chunk: ${result.bundle.length} bytes`);
					} else {
						sandboxImportLog.info(`Bundle chunk: null data`);
					}
					break;
				case "staged_patch":
					result.stagedPatch = chunk.data;
					sandboxImportLog.info(`Staged patch chunk: ${chunk.data?.length || 0} chars`);
					break;
				case "unstaged_patch":
					result.unstagedPatch = chunk.data;
					sandboxImportLog.info(`Unstaged patch chunk: ${chunk.data?.length || 0} chars`);
					break;
				case "untracked":
					result.untrackedFiles.push({
						path: chunk.path,
						content: Buffer.from(chunk.data, "base64"),
					});
					sandboxImportLog.info(`Untracked file chunk: ${chunk.path}`);
					break;
				case "claude_session":
					result.claudeSessions.push(chunk);
					sandboxImportLog.info(`Claude session chunk: ${chunk.sessionId.slice(0, 8)}... (${chunk.data.length} chars)`);
					break;
				case "error":
					sandboxImportLog.error(`Error chunk received: ${chunk.error}`);
					throw new Error(`Export failed: ${chunk.error}`);
				case "done":
					sandboxImportLog.info(`Done chunk received`);
					break;
			}
		}
	}

	if (!result.meta) {
		sandboxImportLog.error(`No meta chunk received!`);
		throw new Error("Export stream missing metadata");
	}

	sandboxImportLog.info(`parseExportStream completed:`, {
		hasMeta: !!result.meta,
		hasBundle: !!result.bundle,
		hasStagedPatch: !!result.stagedPatch,
		hasUnstagedPatch: !!result.unstagedPatch,
		untrackedFilesCount: result.untrackedFiles.length,
		claudeSessionsCount: result.claudeSessions.length,
	});

	return result;
}

/**
 * Apply sandbox git state to a worktree
 */
export async function applySandboxGitState(
	worktreePath: string,
	exportData: SandboxExportData,
): Promise<{ success: boolean; error?: string }> {
	sandboxImportLog.info(`applySandboxGitState starting...`);
	sandboxImportLog.info(`Worktree path: ${worktreePath}`);

	const git = simpleGit(worktreePath);
	const isFullExport = exportData.meta.isFullExport ?? false;
	sandboxImportLog.info(`Is full export: ${isFullExport}`);

	try {
		// For full exports (cloning to empty repo), set up remote first
		if (isFullExport && exportData.meta.remoteUrl) {
			sandboxImportLog.info(`Setting up remote origin: ${exportData.meta.remoteUrl}`);
			try {
				await git.addRemote("origin", exportData.meta.remoteUrl);
				sandboxImportLog.info(`Added remote origin successfully`);
			} catch (err) {
				// Remote might already exist
				sandboxImportLog.info(`Remote origin already exists or failed to add:`, err);
			}
		}

		// 1. Verify base commit exists locally (skip for full exports)
		if (!isFullExport) {
			const baseCommit = exportData.meta.baseCommit;
			try {
				await git.raw(["cat-file", "-e", baseCommit]);
			} catch {
				// Base commit doesn't exist locally, try to fetch
				sandboxImportLog.info(`Base commit ${baseCommit} not found locally, fetching...`);
				try {
					await git.fetch("origin");
				} catch (fetchError) {
					sandboxImportLog.warn(`Fetch failed: ${fetchError}`);
				}
			}
		}

		// 2. Apply git bundle (if there are new commits)
		if (exportData.bundle) {
			sandboxImportLog.info(`Step 2: Applying git bundle (${exportData.bundle.length} bytes)...`);
			const bundlePath = join(tmpdir(), `sandbox-import-${Date.now()}.bundle`);
			sandboxImportLog.info(`Bundle temp path: ${bundlePath}`);
			try {
				await writeFile(bundlePath, exportData.bundle);
				sandboxImportLog.info(`Bundle written to temp file`);

				// Verify the bundle is valid
				sandboxImportLog.info(`Verifying bundle...`);
				const verifyResult = await execFileAsync("git", ["-C", worktreePath, "bundle", "verify", bundlePath], {
					timeout: 30_000,
				});
				sandboxImportLog.info(`Bundle verify output:`, verifyResult.stdout);

				if (isFullExport) {
					// Full export: fetch all refs from bundle, then checkout the branch
					// Use --update-head-ok to allow fetching into the currently checked out branch
					sandboxImportLog.info(`Full export: fetching all refs from bundle...`);
					const fetchResult = await execFileAsync(
						"git",
						["-C", worktreePath, "fetch", "--update-head-ok", bundlePath, "refs/heads/*:refs/heads/*"],
						{ timeout: 120_000 },
					);
					sandboxImportLog.info(`Fetch output:`, fetchResult.stdout, fetchResult.stderr);

					// Checkout the branch that was active in the sandbox (with force to update working tree)
					const targetBranch = exportData.meta.branch;
					sandboxImportLog.info(`Checking out branch: ${targetBranch}`);
					await git.checkout(["-f", targetBranch]);
					sandboxImportLog.info(`Checked out branch successfully: ${targetBranch}`);
				} else {
					// Delta export: fetch HEAD to temp branch, then reset
					await execFileAsync(
						"git",
						["-C", worktreePath, "fetch", bundlePath, "HEAD:sandbox-import-temp"],
						{ timeout: 60_000 },
					);

					// Reset to the fetched commits
					await git.reset(["--hard", "sandbox-import-temp"]);

					// Clean up temp branch
					await git.branch(["-D", "sandbox-import-temp"]).catch(() => {});
				}
			} finally {
				await unlink(bundlePath).catch(() => {});
			}
		}

		// 3. Apply staged patch (stage the changes)
		if (exportData.stagedPatch) {
			sandboxImportLog.info(`Step 3: Applying staged patch (${exportData.stagedPatch.length} chars)...`);
			const stagedPatchPath = join(tmpdir(), `sandbox-staged-${Date.now()}.patch`);
			try {
				await writeFile(stagedPatchPath, exportData.stagedPatch);

				// Apply and stage
				await execFileAsync(
					"git",
					["-C", worktreePath, "apply", "--cached", stagedPatchPath],
					{ timeout: 60_000 },
				);
				sandboxImportLog.info(`Staged patch applied successfully`);

				// Also apply to working directory
				await execFileAsync("git", ["-C", worktreePath, "checkout", "--", "."], {
					timeout: 30_000,
				}).catch(() => {});
			} catch (error) {
				sandboxImportLog.warn(`Failed to apply staged patch: ${error}`);
			} finally {
				await unlink(stagedPatchPath).catch(() => {});
			}
		} else {
			sandboxImportLog.info(`Step 3: No staged patch to apply`);
		}

		// 4. Apply unstaged patch (don't stage)
		if (exportData.unstagedPatch) {
			sandboxImportLog.info(`Step 4: Applying unstaged patch (${exportData.unstagedPatch.length} chars)...`);
			const unstagedPatchPath = join(tmpdir(), `sandbox-unstaged-${Date.now()}.patch`);
			try {
				await writeFile(unstagedPatchPath, exportData.unstagedPatch);

				await execFileAsync("git", ["-C", worktreePath, "apply", unstagedPatchPath], {
					timeout: 60_000,
				});
				sandboxImportLog.info(`Unstaged patch applied successfully`);
			} catch (error) {
				sandboxImportLog.warn(`Failed to apply unstaged patch: ${error}`);
			} finally {
				await unlink(unstagedPatchPath).catch(() => {});
			}
		} else {
			sandboxImportLog.info(`Step 4: No unstaged patch to apply`);
		}

		// 5. Write untracked files
		sandboxImportLog.info(`Step 5: Writing ${exportData.untrackedFiles.length} untracked files...`);
		for (const file of exportData.untrackedFiles) {
			const fullPath = join(worktreePath, file.path);
			try {
				await mkdir(dirname(fullPath), { recursive: true });
				await writeFile(fullPath, file.content);
				sandboxImportLog.info(`Wrote untracked file: ${file.path}`);
			} catch (error) {
				sandboxImportLog.warn(`Failed to write untracked file ${file.path}: ${error}`);
			}
		}

		sandboxImportLog.info(`applySandboxGitState completed successfully!`);
		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		sandboxImportLog.error(`applySandboxGitState FAILED: ${errorMessage}`);
		sandboxImportLog.error(`Stack:`, error);
		return { success: false, error: errorMessage };
	}
}

/**
 * Fetch and apply sandbox export to a worktree
 * @param fullExport - If true, exports entire repo (for cloning to empty local repo)
 * @param sessionId - If provided, only export this specific Claude session (for subchat import)
 */
export async function importSandboxToWorktree(
	worktreePath: string,
	apiUrl: string,
	sandboxId: string,
	token: string,
	fullExport: boolean = false,
	sessionId?: string,
): Promise<{ success: boolean; error?: string; claudeSessions?: ExportClaudeSession[] }> {
	try {
		// Fetch export stream from API
		const queryParams: string[] = [];
		if (fullExport) queryParams.push("full=true");
		if (sessionId) queryParams.push(`sessionId=${sessionId}`);
		const queryString = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
		const exportUrl = `${apiUrl}/api/agents/sandbox/${sandboxId}/export${queryString}`;
		openLocallyLog.info(`Fetching sandbox export from: ${exportUrl}`);

		const response = await fetch(exportUrl, {
			method: "GET",
			headers: {
				"X-Desktop-Token": token,
				Accept: "application/x-ndjson",
			},
		});

		sandboxImportLog.info(`Export response status: ${response.status} ${response.statusText}`);

		if (!response.ok) {
			throw new Error(`Export API returned ${response.status}: ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error("Export API returned no body");
		}

		// Parse the export stream
		sandboxImportLog.info(`Parsing export stream...`);
		const exportData = await parseExportStream(response.body);

		sandboxImportLog.info(`Export data parsed:`, {
			branch: exportData.meta.branch,
			baseCommit: exportData.meta.baseCommit,
			headCommit: exportData.meta.headCommit,
			isFullExport: exportData.meta.isFullExport,
			remoteUrl: exportData.meta.remoteUrl,
			hasBundle: !!exportData.bundle,
			bundleSize: exportData.bundle?.length,
			hasStagedPatch: !!exportData.stagedPatch,
			hasUnstagedPatch: !!exportData.unstagedPatch,
			untrackedFilesCount: exportData.untrackedFiles.length,
			claudeSessionsCount: exportData.claudeSessions.length,
		});

		// Apply the git state
		sandboxImportLog.info(`Applying git state to worktree: ${worktreePath}`);
		const gitResult = await applySandboxGitState(worktreePath, exportData);

		// Return claudeSessions along with git result
		return {
			...gitResult,
			claudeSessions: exportData.claudeSessions,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		sandboxImportLog.error(`Import failed:`, errorMessage);
		return { success: false, error: errorMessage };
	}
}
