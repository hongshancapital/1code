import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  currentPlanPathAtomFamily,
  pendingBuildPlanSubChatIdAtom,
  planEditRefetchTriggerAtomFamily,
  planSidebarOpenAtomFamily,
} from "../atoms";
import { useAgentSubChatStore } from "../stores/sub-chat-store";

export interface UsePlanSidebarStateResult {
  isPlanSidebarOpen: boolean;
  setIsPlanSidebarOpen: (open: boolean) => void;
  currentPlanPath: string | null;
  setCurrentPlanPath: (path: string | null) => void;
  planEditRefetchTrigger: number;
  triggerPlanRefetch: () => void;
  handleApprovePlanFromSidebar: () => void;
  handleExpandPlan: () => void;
}

export function usePlanSidebarState(): UsePlanSidebarStateResult {
  // Subscribe to activeSubChatId for plan sidebar (needs to update when switching sub-chats)
  const activeSubChatIdForPlan = useAgentSubChatStore(
    (state) => state.activeSubChatId,
  );

  // Per-subChat plan sidebar state - each sub-chat remembers its own open/close state
  const planSidebarAtom = useMemo(
    () => planSidebarOpenAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  );
  const [isPlanSidebarOpen, setIsPlanSidebarOpen] = useAtom(planSidebarAtom);

  const currentPlanPathAtom = useMemo(
    () => currentPlanPathAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  );
  const [currentPlanPath, setCurrentPlanPath] = useAtom(currentPlanPathAtom);

  // Close plan sidebar when switching to a sub-chat that has no plan
  const prevSubChatIdRef = useRef(activeSubChatIdForPlan);
  useEffect(() => {
    if (prevSubChatIdRef.current !== activeSubChatIdForPlan) {
      // Sub-chat changed - if new one has no plan path, close sidebar
      if (!currentPlanPath) {
        setIsPlanSidebarOpen(false);
      }
      prevSubChatIdRef.current = activeSubChatIdForPlan;
    }
  }, [activeSubChatIdForPlan, currentPlanPath, setIsPlanSidebarOpen]);

  const setPendingBuildPlanSubChatId = useSetAtom(
    pendingBuildPlanSubChatIdAtom,
  );

  // Read plan edit refetch trigger from atom (set by ChatViewInner when Edit completes)
  const planEditRefetchTriggerAtom = useMemo(
    () => planEditRefetchTriggerAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  );
  const planEditRefetchTrigger = useAtomValue(planEditRefetchTriggerAtom);
  const triggerPlanRefetch = useSetAtom(planEditRefetchTriggerAtom);

  // Handler for plan sidebar "Build plan" button
  // Uses getState() to get fresh activeSubChatId (avoids stale closure)
  const handleApprovePlanFromSidebar = useCallback(() => {
    const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId;
    if (activeSubChatId) {
      setPendingBuildPlanSubChatId(activeSubChatId);
    }
  }, [setPendingBuildPlanSubChatId]);

  // Handler for expanding plan sidebar - opens sidebar and triggers refetch
  // This ensures plan content is refreshed when "View plan" is clicked,
  // even if the sidebar is already open
  const handleExpandPlan = useCallback(() => {
    setIsPlanSidebarOpen(true);
    // Always trigger refetch when expanding to ensure fresh content
    triggerPlanRefetch();
  }, [setIsPlanSidebarOpen, triggerPlanRefetch]);

  return {
    isPlanSidebarOpen,
    setIsPlanSidebarOpen,
    currentPlanPath,
    setCurrentPlanPath,
    planEditRefetchTrigger,
    triggerPlanRefetch,
    handleApprovePlanFromSidebar,
    handleExpandPlan,
  };
}
