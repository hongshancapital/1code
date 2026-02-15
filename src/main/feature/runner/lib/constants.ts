/**
 * Runtime Detection Constants
 */

import type { ToolCategory } from "./types"

export const CATEGORY_INFO: Record<
  ToolCategory,
  { displayName: string; required: boolean; description: string }
> = {
  package_manager: {
    displayName: "Package Manager",
    required: true,
    description: "System package manager for installing tools",
  },
  vcs: {
    displayName: "Version Control",
    required: true,
    description: "Git for code versioning",
  },
  search: {
    displayName: "Search",
    required: true,
    description: "Fast file search",
  },
  json: {
    displayName: "JSON",
    required: false,
    description: "JSON processing",
  },
  network: {
    displayName: "Network",
    required: false,
    description: "HTTP requests",
  },
  js_runtime: {
    displayName: "JavaScript",
    required: true,
    description: "JavaScript/TypeScript runtime",
  },
  python_runtime: {
    displayName: "Python",
    required: false,
    description: "Python interpreter",
  },
  python_pkg: {
    displayName: "Python Packages",
    required: false,
    description: "Python package manager",
  },
  go_runtime: {
    displayName: "Go",
    required: false,
    description: "Go programming language",
  },
  rust_runtime: {
    displayName: "Rust",
    required: false,
    description: "Rust programming language",
  },
}
