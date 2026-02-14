/**
 * ChatViewLoadingPlaceholder - Renders a disabled input placeholder when chat is loading
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Shows an empty chat area with a disabled input that mimics the real input layout.
 */

import { memo } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "../../../lib/utils"
import { Button } from "../../../components/ui/button"
import {
  PromptInput,
  PromptInputActions,
} from "../../../components/ui/prompt-input"
import {
  AgentIcon,
  AttachIcon,
  ClaudeCodeIcon,
} from "../../../components/ui/icons"
import { AgentSendButton } from "./agent-send-button"

export interface ChatViewLoadingPlaceholderProps {
  isChatFullWidth: boolean
  hasCustomClaudeConfig: boolean
}

export const ChatViewLoadingPlaceholder = memo(function ChatViewLoadingPlaceholder({
  isChatFullWidth,
  hasCustomClaudeConfig,
}: ChatViewLoadingPlaceholderProps) {
  return (
    <>
      {/* Empty chat area - no loading indicator */}
      <div className="flex-1" />

      {/* Disabled input while loading */}
      <div className="px-2 pb-2">
        <div className={cn("w-full mx-auto", !isChatFullWidth && "max-w-2xl")}>
          <div className="relative w-full">
            <PromptInput
              className="border bg-input-background relative z-10 p-2 rounded-xl opacity-50 pointer-events-none"
              maxHeight={200}
            >
              <div className="p-1 text-muted-foreground text-sm">
                Plan, @ for context, / for commands
              </div>
              <PromptInputActions className="w-full">
                <div className="flex items-center gap-0.5 flex-1 min-w-0">
                  {/* Mode selector placeholder */}
                  <button
                    disabled
                    className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md cursor-not-allowed"
                  >
                    <AgentIcon className="h-3.5 w-3.5" />
                    <span>Agent</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                  </button>

                  {/* Model selector placeholder */}
                  <button
                    disabled
                    className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md cursor-not-allowed"
                  >
                    <ClaudeCodeIcon className="h-3.5 w-3.5" />
                    <span>
                      {hasCustomClaudeConfig ? (
                        "Custom Model"
                      ) : (
                        <>
                          Sonnet{" "}
                          <span className="text-muted-foreground">
                            4.5
                          </span>
                        </>
                      )}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                  </button>
                </div>
                <div className="flex items-center gap-0.5 ml-auto shrink-0">
                  {/* Attach button placeholder */}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled
                    className="h-7 w-7 rounded-sm cursor-not-allowed"
                  >
                    <AttachIcon className="h-4 w-4" />
                  </Button>

                  {/* Send button */}
                  <div className="ml-1">
                    <AgentSendButton
                      disabled={true}
                      onClick={() => {}}
                    />
                  </div>
                </div>
              </PromptInputActions>
            </PromptInput>
          </div>
        </div>
      </div>
    </>
  )
})
