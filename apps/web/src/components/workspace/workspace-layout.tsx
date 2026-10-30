import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  type UIEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  getCurrentFlareMoUser,
  getMemoStats,
  getTagHierarchy,
  type MemoStatsResponse,
} from "@/api";
import {
  WorkspaceSidebar,
  type WorkspaceSidebarContent,
} from "@/components/workspace/workspace-sidebar";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { queryKeys } from "@/lib/query-keys";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";
import { TIMELINE_SEARCH } from "@/lib/timeline-search";

const AccountSettingsDialog = lazy(() =>
  import("@/pages/account-page").then((module) => ({
    default: module.AccountSettingsDialog,
  })),
);

const SIDEBAR_COLLAPSED_KEY = "flaremo.sidebar.collapsed";

const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

export type WorkspaceHeaderRenderProps = {
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  explorer: WorkspaceSidebarContent;
};

/**
 * One number, not two classes. The shell previously took a `maxWidthClass`
 * for the content column and a separate `outerMaxWidthClass` for the row that
 * contains it; a page that widened only the former still got a content column
 * clamped by the untouched latter, so `/projects` asked for 1024px and
 * rendered 638px — its three kanban columns landed at 92px each and the task
 * titles wrapped one character per line. The outer width is now derived, so
 * the two cannot disagree.
 */
export type WorkspaceLayoutProps = {
  header: (props: WorkspaceHeaderRenderProps) => ReactNode;
  children: ReactNode;
  mainRef?: RefObject<HTMLElement | null>;
  onScroll?: (event: UIEvent<HTMLElement>) => void;
  /** Content column width in px; the sidebar column is added on top of it. */
  contentMaxWidth?: number;
};

/** Desktop sidebar width, and therefore the shell's gutter beside the content. */
export const WORKSPACE_SIDEBAR_WIDTH = 312;
const DEFAULT_CONTENT_MAX_WIDTH = 640;

export function WorkspaceLayout({
  header,
  children,
  mainRef,
  onScroll,
  contentMaxWidth = DEFAULT_CONTENT_MAX_WIDTH,
}: WorkspaceLayoutProps) {
  const navigate = useNavigate();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort
      }
      return next;
    });
  }, []);

  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  const currentUserQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
    staleTime: 60_000,
  });

  const tagHierarchyQuery = useQuery({
    queryKey: ["tag-hierarchy", "all"],
    queryFn: () => getTagHierarchy("all"),
    staleTime: 30_000,
  });

  const statsQuery = useQuery({
    // Shares the key with the explorer's stats query so the page issues one
    // request. Both must name the same window or React Query would treat them
    // as two entries and fetch the stats twice.
    queryKey: ["memo-stats", "all", timeZone, ACTIVITY_WINDOW_DAYS],
    queryFn: () => getMemoStats(timeZone, "all", ACTIVITY_WINDOW_DAYS),
    staleTime: 30_000,
  });

  const {
    deleteTagMutation,
    handleMutationError,
    invalidateWorkspace,
    renameTagMutation,
  } = useMemoMutations();

  const { handleExport, handleImportFile } = useDataTransfer({
    handleMutationError,
    invalidateWorkspace,
  });

  const stats: MemoStatsResponse = statsQuery.data ?? EMPTY_STATS;

  const sidebarContent: WorkspaceSidebarContent = useMemo(() => {
    const deleteTag = deleteTagMutation.mutate;
    const renameTag = renameTagMutation.mutate;
    return {
      hierarchy: tagHierarchyQuery.data?.tags ?? [],
      hierarchyPending: tagHierarchyQuery.isPending,
      space: "all",
      stats,
      timeZone,
      untagged: false,
      user: currentUserQuery.data,
      onDeleteTag: (tag) => deleteTag(tag),
      onExport: handleExport,
      onImportFile: handleImportFile,
      onOpenSettings: () => setAccountSettingsOpen(true),
      onRenameTag: (from, to) => renameTag({ from, to }),
      // Tag filters live on the timeline; from any other workspace page a tag
      // click jumps there with the filter applied instead of doing nothing.
      onTagChange: (tag) => {
        setMobileSheetOpen(false);
        void navigate({ to: "/", search: { ...TIMELINE_SEARCH, tag } });
      },
      onToggleCollapsed: toggleSidebarCollapsed,
      onUntaggedChange: (next) => {
        setMobileSheetOpen(false);
        void navigate({
          to: "/",
          search: { ...TIMELINE_SEARCH, untagged: next || undefined },
        });
      },
    };
  }, [
    tagHierarchyQuery.data,
    tagHierarchyQuery.isPending,
    stats,
    // Read into the sidebar content below; omitting it left the sidebar on a
    // stale zone after the viewer changed their time zone.
    timeZone,
    currentUserQuery.data,
    deleteTagMutation.mutate,
    renameTagMutation.mutate,
    handleExport,
    handleImportFile,
    navigate,
    toggleSidebarCollapsed,
  ]);

  return (
    <div className="h-svh overflow-hidden bg-background">
      {/* Sidebar + content, sized from one number: the shell must be at least
          as wide as the content column plus the sidebar it sits beside. */}
      <div
        className="mx-auto flex h-full w-full"
        style={{ maxWidth: contentMaxWidth + WORKSPACE_SIDEBAR_WIDTH }}
      >
        <WorkspaceSidebar
          collapsed={sidebarCollapsed}
          explorer={sidebarContent}
        />
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {header({
            sidebarCollapsed,
            toggleSidebarCollapsed,
            mobileSheetOpen,
            setMobileSheetOpen,
            explorer: sidebarContent,
          })}
          <main
            ref={mainRef}
            className="mx-auto min-h-0 w-full flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3"
            onScroll={onScroll}
            style={{ maxWidth: contentMaxWidth }}
          >
            {children}
          </main>
        </div>
      </div>
      <Suspense fallback={null}>
        {accountSettingsOpen && (
          <AccountSettingsDialog
            open={accountSettingsOpen}
            onClose={() => setAccountSettingsOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
