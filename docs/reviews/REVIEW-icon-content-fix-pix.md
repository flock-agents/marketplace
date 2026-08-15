# Review: Icon Content Fix — Frontend
**Reviewer:** Pix (Frontend/UI)
**Date:** 2026-08-15
**Status:** PASS (dispatched via delegate, session 57b50518 — returned done)

## Scope

1. Fixed SkillIcon.tsx fallback chain bug — split single `imgFailed` state into independent `apiIconFailed` and `urlIconFailed` states so uninstalled marketplace skills properly fall back to `iconUrl` instead of skipping to letter.
2. Redesigned 5 marketplace skill SVG icons to be recognizable service representations instead of generic placeholders.

## Files Reviewed

### Modified: `crafo-claw/flock-app/frontend/src/components/SkillIcon.tsx`
- Fallback chain now: API icon → iconUrl → emoji → letter (each stage fails independently)
- Fixes BigBasket ("B") and Amazon ("A") letter fallbacks for uninstalled skills

### Modified: `marketplace/skills/linear/icon.svg`
- 3 parallel diagonal lines on purple (recognizable angular stacked mark)

### Modified: `marketplace/skills/zepto/icon.svg`
- Shopping bag with sparkle accents on purple

### Modified: `marketplace/skills/zomato-blinkit/icon.svg`
- Lightning bolt on yellow (Blinkit delivery speed theme)

### Modified: `marketplace/skills/bigbasket/icon.svg`
- Shopping basket with cart wheels on green

### Modified: `marketplace/skills/amazon/icon.svg`
- Shopping bag with signature smile arrow on dark

## Verdict

Dispatched to Pix (session 57b50518). Returned done — no P0 issues raised.
