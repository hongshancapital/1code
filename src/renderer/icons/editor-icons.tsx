/**
 * Editor Icons
 * SVG icons for various code editors
 */

import { cn } from "../lib/utils"

interface EditorIconProps {
  className?: string
}

/**
 * VS Code Icon
 * Source: Official Visual Studio Code branding
 */
export function VSCodeIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

/**
 * Cursor Icon
 * Source: Official Cursor branding
 */
export function CursorIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      fillRule="evenodd"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  )
}

/**
 * Windsurf Icon (Codeium)
 * Source: Official Windsurf branding
 */
export function WindsurfIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M23.78 5.004h-.228a2.187 2.187 0 00-2.18 2.196v4.912c0 .98-.804 1.775-1.76 1.775a1.818 1.818 0 01-1.472-.773L13.168 5.95a2.197 2.197 0 00-1.81-.95c-1.134 0-2.154.972-2.154 2.173v4.94c0 .98-.797 1.775-1.76 1.775-.57 0-1.136-.289-1.472-.773L.408 5.098C.282 4.918 0 5.007 0 5.228v4.284c0 .216.066.426.188.604l5.475 7.889c.324.466.8.812 1.351.938 1.377.316 2.645-.754 2.645-2.117V11.89c0-.98.787-1.775 1.76-1.775h.002c.586 0 1.135.288 1.472.773l4.972 7.163a2.15 2.15 0 001.81.95c1.158 0 2.151-.973 2.151-2.173v-4.939c0-.98.787-1.775 1.76-1.775h.194c.122 0 .22-.1.22-.222V5.225a.221.221 0 00-.22-.222z" />
    </svg>
  )
}

/**
 * Antigravity Icon (Google)
 * Stylized A shape matching official branding
 */
export function AntigravityIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2L3 20h4l1.5-3h7l1.5 3h4L12 2zm0 6l2.5 6h-5L12 8z" />
    </svg>
  )
}

/**
 * Zed Icon
 * Source: Zed editor branding - stylized Z
 */
export function ZedIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3 5h18v2H7.5L21 18v2H3v-2h13.5L3 7z" />
    </svg>
  )
}

/**
 * Sublime Text Icon
 * Source: Sublime Text branding - stylized S
 */
export function SublimeTextIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.953 6.674L3.047 12.674v2.641l17.906-6v-2.641zM3.047 21.326l17.906-6v-2.641l-17.906 6v2.641zM3.047 8.674l17.906-6v2.641l-17.906 6v-2.641z" />
    </svg>
  )
}

/**
 * IntelliJ IDEA Icon
 * Source: JetBrains branding
 */
export function IntelliJIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 2h20v20H2V2zm2 2v16h16V4H4zm2 2h3v2H6V6zm5 0h2v8h-2V6zm4 0h3v2h-3V6zm-9 4h3v2H6v-2zm9 0h3v2h-3v-2zM6 14h6v2H6v-2z" />
    </svg>
  )
}

/**
 * WebStorm Icon
 * Source: JetBrains branding
 */
export function WebStormIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 2h20v20H2V2zm2 2v16h16V4H4zm2 2h2l1.5 6 1.5-6h2l1.5 6 1.5-6h2l-2.5 8h-2l-1.5-5-1.5 5h-2L6 6zm0 10h6v2H6v-2z" />
    </svg>
  )
}

/**
 * Generic Code Editor Icon
 * Used as fallback when specific editor icon is not available
 */
export function GenericEditorIcon({ className }: EditorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("w-4 h-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

/**
 * Map editor ID to icon component
 */
export const EDITOR_ICONS: Record<string, React.ComponentType<EditorIconProps>> = {
  code: VSCodeIcon,
  cursor: CursorIcon,
  windsurf: WindsurfIcon,
  agy: AntigravityIcon,
  zed: ZedIcon,
  subl: SublimeTextIcon,
  idea: IntelliJIcon,
  webstorm: WebStormIcon,
}

/**
 * Get editor icon by ID, with fallback to generic icon
 */
export function getEditorIcon(editorId: string): React.ComponentType<EditorIconProps> {
  return EDITOR_ICONS[editorId] ?? GenericEditorIcon
}
