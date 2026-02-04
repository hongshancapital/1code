import { useMemo } from "react"
import { useSetAtom } from "jotai"
import { trpc } from "../../../lib/trpc"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { ChevronRight } from "lucide-react"
import { SkillIconFilled } from "../../ui/icons"
import {
  agentsSettingsDialogActiveTabAtom,
} from "../../../lib/atoms"

interface ProjectSkillsTabProps {
  projectId: string
  projectPath: string | null
}

export function ProjectSkillsTab({ projectPath }: ProjectSkillsTabProps) {
  const setActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)

  // Fetch skills for the project
  const { data: skills, isLoading: skillsLoading } = trpc.skills.list.useQuery(
    { cwd: projectPath ?? undefined },
    { enabled: !!projectPath }
  )

  // Fetch enabled skills
  const { data: enabledSkills, refetch: refetchEnabled } = trpc.claudeSettings.getEnabledSkills.useQuery(
    { cwd: projectPath ?? undefined },
    { enabled: !!projectPath }
  )

  // Toggle skill mutation
  const toggleMutation = trpc.claudeSettings.setSkillEnabled.useMutation({
    onSuccess: () => {
      refetchEnabled()
    },
  })

  // Filter to only show user and project skills
  const filteredSkills = useMemo(() => {
    if (!skills) return { user: [], project: [] }
    const user = skills.filter((s) => s.source === "user")
    const project = skills.filter((s) => s.source === "project")
    return { user, project }
  }, [skills])

  const handleToggle = (skillName: string, enabled: boolean) => {
    toggleMutation.mutate({
      cwd: projectPath ?? undefined,
      skillName,
      enabled,
    })
  }

  const hasSkills = filteredSkills.user.length > 0 || filteredSkills.project.length > 0

  if (skillsLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <SkillIconFilled className="h-5 w-5 text-muted-foreground animate-pulse" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        {!hasSkills ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <SkillIconFilled className="h-10 w-10 text-border mb-4" />
            <p className="text-sm text-muted-foreground mb-1">No skills available</p>
            <p className="text-xs text-muted-foreground">
              Add skills in the global settings or create project-specific skills in{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">.claude/skills/</code>
            </p>
          </div>
        ) : (
          <>
            {/* User Skills */}
            {filteredSkills.user.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">User Skills</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Skills from your global configuration (~/.claude/skills/)
                </p>
                <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
                  {filteredSkills.user.map((skill) => {
                    const isEnabled = enabledSkills?.[skill.name] !== false
                    return (
                      <div
                        key={skill.name}
                        className="flex items-center justify-between p-4"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <span className="text-sm font-medium text-foreground">
                            {skill.interface?.display_name || skill.name}
                          </span>
                          {skill.interface?.short_description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {skill.interface.short_description}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => handleToggle(skill.name, checked)}
                          disabled={toggleMutation.isPending}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Project Skills */}
            {filteredSkills.project.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">Project Skills</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Skills specific to this project (.claude/skills/)
                </p>
                <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
                  {filteredSkills.project.map((skill) => {
                    const isEnabled = enabledSkills?.[skill.name] !== false
                    return (
                      <div
                        key={skill.name}
                        className="flex items-center justify-between p-4"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <span className="text-sm font-medium text-foreground">
                            {skill.interface?.display_name || skill.name}
                          </span>
                          {skill.interface?.short_description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {skill.interface.short_description}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => handleToggle(skill.name, checked)}
                          disabled={toggleMutation.isPending}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Link to global settings */}
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setActiveTab("skills")}
          >
            Manage all skills
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
