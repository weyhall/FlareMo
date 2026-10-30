import { PanelLeftOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { WorkspaceMobileSidebar } from "@/components/workspace/workspace-sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function WorkspacePageHeader({
  icon,
  title,
  actions,
  explorer,
  mobileSheetOpen,
  setMobileSheetOpen,
  sidebarCollapsed,
  toggleSidebarCollapsed,
  contentMaxWidth = 640,
  isScrolled = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  explorer: WorkspaceSidebarContent;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  /** Mirrors WorkspaceLayout's content column so the two stay aligned. */
  contentMaxWidth?: number;
  isScrolled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <header
      className={cn(
        "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
        isScrolled ? "border-border shadow-xs" : "border-transparent",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 px-5 lg:px-3 motion-safe:transition-[max-width,padding] motion-safe:duration-250 motion-safe:ease-signal",
          sidebarCollapsed && "mx-auto w-full",
        )}
        style={sidebarCollapsed ? { maxWidth: contentMaxWidth } : undefined}
      >
        <div
          className={cn(
            "hidden lg:flex items-center overflow-hidden motion-safe:transition-[width,opacity,margin] motion-safe:duration-250 motion-safe:ease-signal",
            sidebarCollapsed
              ? "w-8 opacity-100"
              : "w-0 opacity-0 pointer-events-none -mr-2",
          )}
        >
          <Button
            aria-label={t("sidebar.expand")}
            size="icon-sm"
            title={t("sidebar.expand")}
            variant="ghost"
            onClick={toggleSidebarCollapsed}
          >
            <PanelLeftOpenIcon />
          </Button>
        </div>

        <WorkspaceMobileSidebar
          explorer={explorer}
          open={mobileSheetOpen}
          onOpenChange={setMobileSheetOpen}
        />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* min-w-0 on the row as well as the parent: without it the flex
              item keeps its content width and `truncate` on the h1 has nothing
              to shrink into, so a long title ran under the actions. */}
          <div className="flex min-w-0 items-center gap-2 px-1">
            {icon}
            <h1 className="min-w-0 truncate text-[15px] leading-none font-semibold tracking-tight">
              {title}
            </h1>
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
