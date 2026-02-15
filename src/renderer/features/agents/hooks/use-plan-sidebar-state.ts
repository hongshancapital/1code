import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  currentPlanPathAtomFamily,
  pendingBuildPlanSubChatIdAtom,
  planEditRefetchTriggerAtomFamily,
} from "../atoms";
import { panelIsOpenAtomFamily } from "../stores/panel-state-manager";
import { PANEL_IDS } from "../stores/panel-registry";
import { useChatInstanceSafe } from "../context/chat-instance-context";
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
  const chatInstance = useChatInstanceSafe();
  const chatId = chatInstance?.chatId ?? "";

  // Subscribe to activeSubChatId for plan sidebar (needs to update when switching sub-chats)
  const activeSubChatIdForPlan = useAgentSubChatStore(
    (state) => state.activeSubChatId,
  );

  // Plan sidebar open state — uses new panel state manager (chatId-scoped)
  const planOpenAtom = useMemo(
    () => panelIsOpenAtomFamily({ chatId, panelId: PANEL_IDS.PLAN }),
    [chatId],
  );
  const [isPlanSidebarOpen, setIsPlanSidebarOpen] = useAtom(planOpenAtom);

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
