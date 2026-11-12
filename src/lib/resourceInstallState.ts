import type { Project, Task } from "./types";

export function resourceInstallKey(project: Project, kind: string, target: string) {
  return JSON.stringify([
    kind,
    project.source || "modrinth",
    project.project_id,
    kind === "modpacks" ? "" : target,
  ]);
}

export function hasResourceInstall(
  tasks: Record<string, Task>,
  project: Project,
  kind: string,
  target: string,
) {
  return Object.values(tasks).some((task) => {
    const p = task.payload;
    return (
      task.action === "install_project" &&
      !task.finished &&
      !task.error &&
      p?.project === project.project_id &&
      (p.source || "modrinth") === (project.source || "modrinth") &&
      p.kind === kind &&
      (kind === "modpacks" || p.id === target)
    );
  });
}
