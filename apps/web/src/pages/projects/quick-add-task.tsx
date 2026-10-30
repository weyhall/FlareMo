import { useMutation } from "@tanstack/react-query";
import { CornerDownLeftIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createTask, type Project } from "@/api";
import { useI18n } from "@/i18n";
import { addDays, todayKey } from "@/lib/calendar-date";
import { errorMessage } from "@/lib/error";
import type { TaskView } from "@/lib/task-views";

/**
 * One line at the top of every list: type, Enter, done. The task lands where
 * the author is looking: in the open project, or due today / tomorrow in the
 * matching view, so it never vanishes from the list it was typed into.
 */
export function QuickAddTask({
  project,
  view,
  onCreated,
}: {
  project: Project | null;
  view: TaskView;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const due =
    project || view === "all"
      ? undefined
      : view === "today"
        ? todayKey()
        : addDays(todayKey(), 1);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      createTask({
        title: value,
        ...(project ? { project_id: project.id } : {}),
        ...(due ? { due_at: due } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      onCreated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.taskCreateFailed"))),
  });

  const hint = project
    ? t("projects.quickAdd.inProject", { name: project.name })
    : view === "today"
      ? t("projects.quickAdd.today")
      : view === "upcoming"
        ? t("projects.quickAdd.tomorrow")
        : t("projects.quickAdd.inbox");

  return (
    <form
      className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-border/80 bg-card px-3 shadow-xs focus-within:border-[color-mix(in_oklch,var(--input),var(--foreground)_10%)]"
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value || mutation.isPending) return;
        mutation.mutate(value);
      }}
    >
      <PlusIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <input
        aria-label={t("projects.quickAdd.label")}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        disabled={mutation.isPending}
        placeholder={t("projects.quickAdd.placeholder")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {hint}
      </span>
      <CornerDownLeftIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground/60"
      />
    </form>
  );
}
