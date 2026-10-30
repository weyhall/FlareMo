import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useMemo } from "react";
import { listProjects } from "@/api";
import { TaskRow } from "@/components/task-row";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { taskInView, useAllTasks } from "@/lib/task-views";

const MAX_ROWS = 8;

/**
 * What is due today (and what slipped), ticked in place. Shown at the top
 * of the daily review: looking back at old notes and looking at today's
 * work are the same morning ritual. Renders nothing on a day with nothing
 * due, so the review stays about the notes.
 */
export function TodayTasks() {
  const { t } = useI18n();
  const tasksQuery = useAllTasks();
  const tasks = useMemo(() => {
    const today = todayKey();
    return (tasksQuery.data?.tasks ?? [])
      .filter((task) => taskInView(task, "today", today))
      .sort(
        (a, b) =>
          Number(a.status === "done") - Number(b.status === "done") ||
          (a.due_at ?? "").localeCompare(b.due_at ?? ""),
      );
  }, [tasksQuery.data]);
  const needsProjects = tasks.some((task) => task.project_id);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    enabled: needsProjects,
    staleTime: 60_000,
  });
  const projectName = useMemo(() => {
    const names = new Map(
      (projectsQuery.data?.projects ?? []).map((p) => [p.id, p.name]),
    );
    return (id: string | null) => (id ? names.get(id) : undefined);
  }, [projectsQuery.data]);

  if (tasks.length === 0) return null;
  const open = tasks.filter((task) => task.status !== "done").length;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          {open > 0 ? t("today.title", { count: open }) : t("today.allDone")}
        </h2>
        <Link
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          search={{ view: "today", project: undefined }}
          to="/projects"
        >
          {t("today.openList")}
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>
      <ul className="paper divide-y divide-border/60 rounded-xl border border-border/80 bg-card">
        {tasks.slice(0, MAX_ROWS).map((task) => (
          <TaskRow
            key={task.id}
            projectName={projectName(task.project_id)}
            task={task}
          />
        ))}
      </ul>
      {tasks.length > MAX_ROWS && (
        <Link
          className="px-1 text-xs text-muted-foreground hover:text-foreground"
          search={{ view: "today", project: undefined }}
          to="/projects"
        >
          {t("today.more", { count: tasks.length - MAX_ROWS })}
        </Link>
      )}
    </section>
  );
}
