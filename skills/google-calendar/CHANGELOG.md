# Changelog

## 1.0.4

- Page scripts never click, focus or type: the event editor's Save button (`save-button.ts`) and each agenda row and popover close button in `listEvents`' detail walk are found and marked (`data-flock-target`), then pressed with Flock's own real clicks. Which element is found, the waits, error codes and JSON outputs are unchanged.
- The unused shell twins (`createEvent.sh`, `getEvent.sh`, `listEvents.sh`, `updateEvent.sh`, `_google_helpers.sh`) are removed; the `.ts` scripts were always the ones that ran.

## 1.0.3

- Functions run with the run_skill tool, not `calendar-exec.sh` or `POST /api/internal/skill-exec`.
