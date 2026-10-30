import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { compileMemory } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

export function MemoryLensDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const compileQuery = useQuery({
    queryKey: ["memories", "compile"],
    queryFn: () => compileMemory({ format: "markdown" }),
    enabled: open,
    staleTime: 5_000,
  });

  const content = compileQuery.data?.compiled ?? "";

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success(t("toast.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("toast.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-brand-500" />
            <DialogTitle>{t("memory.lensTitle")}</DialogTitle>
          </div>
          <DialogDescription>{t("memory.lensDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {compileQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : compileQuery.isError ? (
            <QueryErrorState
              className="min-h-40 text-muted-foreground"
              isRetrying={compileQuery.isFetching}
              onRetry={() => void compileQuery.refetch()}
            />
          ) : content.trim() ? (
            <div className="relative rounded-lg border border-border/70 bg-muted/30 p-4">
              <pre className="max-h-[360px] overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {content}
              </pre>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <CheckIcon className="size-3.5" data-icon="inline-start" />
                  ) : (
                    <CopyIcon className="size-3.5" data-icon="inline-start" />
                  )}
                  {t("common.copy")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
              {t("memory.emptyDescription")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
