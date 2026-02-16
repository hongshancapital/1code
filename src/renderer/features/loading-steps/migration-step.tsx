import { useEffect, useState } from "react"
import { useLoadingPipeline, LoadingStepPriority } from "../../lib/loading-pipeline"
import { trpc } from "../../lib/trpc"
import { createLogger } from "../../lib/logger"

const migrationLog = createLogger("migration-step")

interface MigrationProgress {
  completed: number
  total: number
}

/**
 * Migration Step for Loading Pipeline
 * Shows progress of message data migration from JSON to normalized table
 */
export function useMigrationStep() {
  const { register, complete } = useLoadingPipeline()
  const [progress, setProgress] = useState<MigrationProgress>({ completed: 0, total: 0 })
  const [isRunning, setIsRunning] = useState(false)

  // Query for initial unmigrated count
  const unmigratedCount = trpc.migration.getUnmigratedCount.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  })

  // Mutation for batch migration - must be at Hook top level
  const migrateBatch = trpc.migration.migrateBatch.useMutation()

  useEffect(() => {
    const step = {
      id: "migration",
      priority: LoadingStepPriority.Migration, // 10
      shouldActivate: () => {
        // Check if there are unmigrated sub-chats
        const count = unmigratedCount.data ?? 0
        migrationLog.info("Unmigrated sub-chats:", count)
        return count > 0
      },
      ui: {
        renderBottom: () => (
          <MigrationUI
            progress={progress}
            isRunning={isRunning}
          />
        ),
      },
    }

    register(step)
  }, [register, progress, isRunning, unmigratedCount.data])

  // Start migration when step activates
  useEffect(() => {
    const total = unmigratedCount.data ?? 0

    if (total === 0 || isRunning) {
      return
    }

    const startMigration = async () => {
      setIsRunning(true)
      setProgress({ completed: 0, total })

      try {
        let migrated = 0

        while (migrated < total) {
          const result = await migrateBatch.mutateAsync({ batchSize: 10 })

          migrated += result.migrated
          setProgress({ completed: migrated, total })

          migrationLog.info("Migration progress:", migrated, "/", total)

          if (result.remaining === 0) {
            break
          }

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        complete("migration")
      } catch (e) {
        migrationLog.error("Migration failed:", e)
        // Still complete to not block the app
        complete("migration")
      } finally {
        setIsRunning(false)
      }
    }

    // Delay slightly to ensure UI renders first
    const timer = setTimeout(startMigration, 500)
    return () => clearTimeout(timer)
  }, [unmigratedCount.data, complete, migrateBatch, isRunning])

  return { progress, isRunning }
}

/**
 * Migration UI Component
 */
function MigrationUI({ progress, isRunning }: { progress: MigrationProgress; isRunning: boolean }) {
  const percentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <div className="flex flex-col items-center justify-center gap-4 w-full max-w-md">
      <div className="text-center">
        <h2 className="text-lg font-medium text-foreground">
          正在迁移聊天数据
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          这只需要执行一次
        </p>
      </div>

      <div className="w-full">
        <div className="flex justify-between text-sm text-muted-foreground mb-2">
          <span>{progress.completed} / {progress.total} 个对话</span>
          <span>{percentage}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {isRunning && (
        <p className="text-xs text-muted-foreground">
          正在处理，请稍候...
        </p>
      )}
    </div>
  )
}
