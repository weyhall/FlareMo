import { useMutation } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { archiveProject, deleteProject, type Project } from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { stripResourceName } from "@/lib/utils";
import { MORE_BUTTON_CLASS } from "./constants";
import { ProjectFormDialog } from "./project-form-dialog";

export function ProjectRow({
  project,
  selected,
  onMutated,
  onSelect,
  onDeleted,
}: {
  project: Project;
  selected: boolean;
  onMutated: () => void;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () =>
      archiveProject(
        stripResourceName(project.id, "projects"),
        project.status !== "archived",
      ),
    onSuccess: () => {
      toast.success(
        t(
          project.status === "archived"
            ? "toast.projectUnarchived"
            : "toast.projectArchived",
        ),
      );
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.projectArchiveFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(stripResourceName(project.id, "projects")),
    onSuccess: () => {
      toast.success(t("toast.projectDeleted"));
      onDeleted(project.id);
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.projectDeleteFailed"))),
  });

  return (
    <>
      <div
        className={
          "group flex h-9 shrink-0 items-center gap-3 rounded-lg px-3 text-sm " +
          (selected
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
        <button
          className="min-w-0 flex-1 truncate text-left"
          type="button"
          onClick={() => onSelect(project.id)}
        >
          <span
            className={
              project.status === "archived" ? "text-muted-foreground/70" : ""
            }
          >
            {project.name}
          </span>
        </button>
        {project.task_count_open > 0 && (
          <Badge variant="secondary">{project.task_count_open}</Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={MORE_BUTTON_CLASS}
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
              {project.status === "archived" ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {t(
                project.status === "archived"
                  ? "projects.unarchive"
                  : "projects.archive",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2Icon data-icon="inline-start" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ProjectFormDialog
        key={[project.id, project.name, project.description ?? ""].join("|")}
        open={editing}
        project={project}
        onOpenChange={setEditing}
        onSaved={onMutated}
      />
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projects.deleteProjectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteProjectDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              variant="destructive"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
