# Icon Content Fix — Spec

## Problem
1. Several marketplace skill icons are generic placeholders (purple "Z" for Zepto, abstract circles for Blinkit, vague angular lines for Linear) instead of recognizable service representations.
2. The `SkillIcon` component in crafo-claw has a fallback bug: when `imgFailed` is set to `true` (e.g., API icon 404s for uninstalled skills), the `iconUrl` fallback is also skipped, dropping straight to the letter-initial fallback. This causes Amazon and BigBasket icons to show "A" and "B" letters.

## Requirements

1. **R1**: Fix `SkillIcon.tsx` fallback chain: API icon → `iconUrl` → emoji → letter. Each stage must fail independently.
2. **R2**: Gmail icon must be a recognizable red/white envelope shape.
3. **R3**: Linear icon must be a recognizable geometric mark with stacked angular lines (not a lightning bolt).
4. **R4**: Zepto icon must be a recognizable purple grocery/delivery icon (not just a "Z" letter).
5. **R5**: Zomato Blinkit icon must be a recognizable yellow/green delivery icon with Blinkit's yellow theme.
6. **R6**: BigBasket icon must be a recognizable green basket/grocery icon and must load (not show "B" fallback).
7. **R7**: Amazon icon must be a recognizable orange arrow/smile shopping icon and must load (not show "A" fallback).
8. **R8**: All app and template icons must be clean, simple SVGs with 48x48 viewBox, recognizable at 24px display size.
9. **R9**: Icons must load in both "Available from Marketplace" (using `iconUrl`) and "Installed" (using local API) sections.
10. **R10**: No copyrighted brand logos — icons are inspired representations, not exact copies.
