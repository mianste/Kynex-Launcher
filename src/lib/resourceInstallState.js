export function resourceInstallKey(project, kind, target) {
  return JSON.stringify([
    kind,
    project.source || "modrinth",
    project.project_id,
    kind === "modpacks" ? "" : target,
  ]);
}
export function hasResourceInstall(tasks, project, kind, target) {
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
