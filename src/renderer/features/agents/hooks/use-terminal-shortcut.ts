import { useEffect } from "react";

export interface UseTerminalShortcutOptions {
  isTerminalSidebarOpen: boolean;
  setIsTerminalSidebarOpen: (open: boolean) => void;
}

/**
 * Keyboard shortcut: Cmd+J to toggle terminal sidebar
 */
export function useTerminalShortcut({
  isTerminalSidebarOpen,
  setIsTerminalSidebarOpen,
}: UseTerminalShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        e.code === "KeyJ"
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsTerminalSidebarOpen(!isTerminalSidebarOpen);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isTerminalSidebarOpen, setIsTerminalSidebarOpen]);
}
