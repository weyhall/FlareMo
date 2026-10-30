import { Link } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "@/i18n";
import {
  buildMonthGrid,
  monthOf,
  todayKey,
  type WeekStart,
} from "@/lib/calendar-date";
import { useAllTasks } from "@/lib/task-views";

// Reminders shown above the time horizon in the explorer: open tasks due today
// or overdue. Deep-links straight to /projects where the user can manage and
// resolve them.

function useOpenTasks(rangeStart: string, rangeEnd: string) {
  const today = useMemo(() => todayKey(), []);
  const tasksQuery = useAllTasks();
  return useMemo(() => {
    const map = new Map<string, number>();
    let overdue = 0;
    let dueToday = 0;
    for (const task of tasksQuery.data?.tasks ?? []) {
      if (!task.due_at || task.status === "done") continue;
      if (task.due_at < rangeStart || task.due_at > rangeEnd) continue;
      map.set(task.due_at, (map.get(task.due_at) ?? 0) + 1);
      if (task.due_at < today) overdue += 1;
      if (task.due_at === today) dueToday += 1;
    }
    return { dueToday, map, overdue };
  }, [tasksQuery.data, rangeStart, rangeEnd, today]);
}

function currentMonthGrid(locale: string, today: string) {
  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  return buildMonthGrid(monthOf(today), weekStart, true);
}

export function MiniCalendarReminders() {
  const { locale, t } = useI18n();
  const today = useMemo(() => todayKey(), []);
  const grid = useMemo(() => currentMonthGrid(locale, today), [locale, today]);
  const { dueToday, overdue } = useOpenTasks(
    grid[0].key,
    grid[grid.length - 1].key,
  );

  if (dueToday <= 0 && overdue <= 0) return null;
  return (
    <>
      {dueToday > 0 && (
        <Link
          className="mb-1.5 flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-brand-700 dark:text-brand-200 bg-brand-100 dark:bg-brand-400/12 motion-safe:transition-colors motion-safe:duration-150 hover:bg-brand-100/80 dark:hover:bg-brand-400/20 focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="mini-calendar-today-notice"
          search={{ view: "today" }}
          to="/projects"
        >
          <AlertCircleIcon className="shrink-0" />
          {t("calendar.overdueToday", { count: dueToday })}
        </Link>
      )}
      {overdue > 0 && (
        <Link
          className="mb-1 block px-1 text-xs text-destructive underline-offset-2 hover:underline"
          search={{ view: "today" }}
          to="/projects"
        >
          {t("calendar.overdueCount", { count: overdue })}
        </Link>
      )}
    </>
  );
}
