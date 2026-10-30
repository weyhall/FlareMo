import { useQuery } from "@tanstack/react-query";
import { listMemoryRevisions } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { formatTimestamp } from "./memory-filters";

export function MemoryRevisions({ memoryId }: { memoryId: string }) {
  const { t } = useI18n();
  const revisionsQuery = useQuery({
    queryKey: ["memories", "revisions", memoryId],
    queryFn: () => listMemoryRevisions(memoryId),
  });

  if (revisionsQuery.isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (revisionsQuery.isError) {
    return (
      <QueryErrorState
        className="min-h-40 border text-muted-foreground"
        isRetrying={revisionsQuery.isFetching}
        onRetry={() => void revisionsQuery.refetch()}
      />
    );
  }
  const revisions = revisionsQuery.data?.revisions ?? [];
  if (revisions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("memory.noRevisions")}</p>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {revisions.map((revision) => (
        <div className="text-xs text-muted-foreground" key={revision.id}>
          <time className="tabular-nums">
            {formatTimestamp(revision.created_at)}
          </time>
          <p className="mt-1 whitespace-pre-wrap">{revision.content}</p>
        </div>
      ))}
    </div>
  );
}
