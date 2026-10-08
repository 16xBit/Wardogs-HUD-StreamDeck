const norm = (s) => String(s ?? "").toLowerCase().replace(/\.exe$/, "").trim();

/** True when the config names at least one process or window-title rule. */
export const hasRules = (game = {}) =>
  (game.processNames?.length ?? 0) > 0 || (game.windowTitleContains?.length ?? 0) > 0;

/** fg = { process, title } of the foreground window. */
export function matchesGame(fg, game = {}) {
  const proc = norm(fg?.process);
  const title = String(fg?.title ?? "").toLowerCase();
  const byProcess = proc !== "" && (game.processNames ?? []).some((n) => norm(n) === proc);
  const byTitle = (game.windowTitleContains ?? []).some((t) => t && title.includes(String(t).toLowerCase()));
  return byProcess || byTitle;
}
