/**
 * @module cockpit/flight/alert-text
 * @description The alert centre's words (English, as the agent cockpit's
 * `alerts.*` locale keys): counts, the hidden toggle, the parameter table,
 * the fix actions and the "Apply recommended values" flow. `{count}` fills
 * from `args`; a key ending in `_one`/`_other` is picked by `count`.
 * @license GPL-3.0-only
 */

const TEXT = {
  blocking: "{count} blocking",
  warnings_one: "{count} warning",
  warnings_other: "{count} warnings",
  showHidden: "Show hidden ({count})",
  hideHidden: "Hide hidden ({count})",
  allClear: "All clear: nothing needs attention",
  hiddenNote: "{count} hidden",
  "param.name": "Parameter",
  "param.current": "Current",
  "param.wanted": "Wanted",
  "param.new": "New",
  "param.notReported": "not reported",
  "param.showAll": "Show all {count}",
  "param.showFewer": "Show fewer",
  "action.apply": "Apply recommended values",
  "action.openSetup": "Open setup",
  "action.openSettings": "Open settings",
  "action.openParameters": "Open parameters",
  "action.hide": "Hide",
  "action.unhide": "Show again",
  "action.collapse": "Collapse",
  "action.expand": "Expand",
  "action.cancel": "Cancel",
  groundHint: "Fix from the drone's Aircraft setup (Mission Control or the drone's cockpit)",
  "apply.reading": "Reading the recommended values…",
  "apply.changes_one": "{count} value changes",
  "apply.changes_other": "{count} values change",
  "apply.nothingToChange": "Every value is already set",
  "apply.alreadySet": "{count} already set",
  "apply.reboots": "The flight controller will restart",
  "apply.snapshot": "A snapshot is saved first; you can restore it from Aircraft setup › Setup report.",
  "apply.writing": "Writing values…",
  "apply.done": "Recommended values written",
  "apply.failed": "The values were not written.",
  "chip.blocking": "What blocks take-off",
  "chip.noBlocking": "Nothing blocks take-off",
  "chip.warnings": "Warnings ({count})",
} as const;

export type AlertTextKey = "warnings" | "apply.changes" | keyof typeof TEXT;

/** The alert centre's text for `key`, `{count}` filled in. */
export function alertText(key: AlertTextKey, args: { count?: number } = {}): string {
  const table = TEXT as Record<string, string>;
  const plural = args.count === 1 ? `${key}_one` : `${key}_other`;
  const template = table[plural] ?? table[key] ?? key;
  return template.replace(/\{count\}/g, String(args.count ?? ""));
}
