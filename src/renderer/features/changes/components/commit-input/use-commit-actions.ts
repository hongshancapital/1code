import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "../../../../lib/trpc";
import { appStore } from "../../../../lib/jotai-store";
import { summaryProviderIdAtom, summaryModelIdAtom } from "../../../../lib/atoms";
import { createLogger } from "../../../../lib/logger"

const commitActionsLog = createLogger("CommitActions")


interface CommitActionInput {
	message?: string;
	filePaths?: string[];
}

interface UseCommitActionsOptions {
	worktreePath?: string | null;
	chatId?: string;
	onRefresh?: () => void;
	onCommitSuccess?: () => void;
	onMessageGenerated?: (message: string) => void;
}

export function useCommitActions({
	worktreePath,
	chatId,
	onRefresh,
	onCommitSuccess,
	onMessageGenerated,
}: UseCommitActionsOptions) {
	const [isGenerating, setIsGenerating] = useState(false);
	const queryClient = useQueryClient();

	const handleSuccess = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: [["changes", "getStatus"]] });
		onRefresh?.();
		onCommitSuccess?.();
	}, [queryClient, onRefresh, onCommitSuccess]);

	const handleError = useCallback((error: { message?: string }) => {
		toast.error(`Commit failed: ${error.message ?? "Unknown error"}`);
	}, []);

	// AI commit message generation
	const generateCommitMutation = trpc.chats.generateCommitMessage.useMutation();

	// Use atomic commit when we have selected files (safer, single operation)
	const atomicCommitMutation = trpc.changes.atomicCommit.useMutation();

	// Fallback to regular commit for staged changes
	const commitMutation = trpc.changes.commit.useMutation();

	const commit = useCallback(
		async ({ message, filePaths }: CommitActionInput): Promise<boolean> => {
			if (!worktreePath) {
				toast.error("Worktree path is required");
				return false;
			}

			let commitMessage = message?.trim() ?? "";

			if (!commitMessage && chatId) {
				setIsGenerating(true);
				try {
					const sp = appStore.get(summaryProviderIdAtom);
					const sm = appStore.get(summaryModelIdAtom);
					const result = await generateCommitMutation.mutateAsync({
						chatId,
						filePaths,
						...(sp && sm && { summaryProviderId: sp, summaryModelId: sm }),
					});
					commitMessage = result.message;
					onMessageGenerated?.(result.message);
				} catch (error) {
					commitActionsLog.error("Failed to generate message:", error);
					toast.error("Failed to generate commit message");
					return false;
				} finally {
					setIsGenerating(false);
				}
			}

			if (!commitMessage) {
				toast.error("Please enter a commit message");
				return false;
			}

			try {
				if (filePaths && filePaths.length > 0) {
					await atomicCommitMutation.mutateAsync({
						worktreePath,
						filePaths,
						message: commitMessage,
					});
				} else {
					await commitMutation.mutateAsync({ worktreePath, message: commitMessage });
				}
				handleSuccess();
				return true;
			} catch (error) {
				handleError(error as { message?: string });
				return false;
			}
		},
		[
			worktreePath,
			chatId,
			generateCommitMutation,
			onMessageGenerated,
			atomicCommitMutation,
			commitMutation,
			handleSuccess,
			handleError,
		],
	);

	const isPending = isGenerating || atomicCommitMutation.isPending || commitMutation.isPending;

	return { commit, isPending, isGenerating };
}
