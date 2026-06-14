# Changelog

All notable changes to this project are documented here.

## [7.0.1] - 2026-06-14
### Fixed
- **Cards that had a handle but would not move** — some cards (e.g. one wrapped in a swipe/carousel) render as `display:inline`, and CSS ignores `transform` on inline elements, so dragging registered but the card never actually moved. Attached cards are now forced to a transformable display.

## [7.0.0] - 2026-06-14
### Added
- **Style "format painter"** — copy one card's whole look (📋) and paint it onto one or many selected cards (🖌️), from the style panel or the multi-select toolbar.
- **Configuration without editing source** — set `window.ShimonFreeformConfig = { scope, grid }` before the resource loads.
- **Redo** (↷ button, `Ctrl+Shift+Z` / `Ctrl+Y`) alongside undo.
- **Toasts** — transient confirmations for reset / rescue.
- **First-run coachmark** pointing at the edit button.
- **Internationalisation** — English, French, Hebrew, auto-detected from the Home Assistant language; correct LTR and RTL layouts.
- **Per-card lock** and **double-click → native Home Assistant card editor**.

### Fixed
- **Late-rendering cards** (camera streams, swipe cards) now attach automatically via a lightweight re-scan — no more handle-less cards after a slow load.
- One incompatible card can no longer abort the whole scan (per-card crash isolation).
- Layout is re-asserted after Home Assistant re-renders a card on a state change.
- Resizing now scales **content** (not just the frame); top badges grow consistently and no longer disappear.
- Mobile: the dashboard stays scrollable in edit mode; finger-sized handles.
- The view is no longer left stretched after editing.

### Security
- All stored/synced layout records are validated on read: numbers clamped, style keys whitelisted, backgrounds restricted to a safe CSS allowlist (no `url()` beacons, no CSS breakout).

## [6.0.0] - 2026-06
### Added
- Per-card style panel (opacity / blur / radius / shadow / rotate / background) with one-tap presets and a colour picker.
- Multi-select, magnetic alignment guides, align / distribute, z-order.
- Layout **scenes** with per-breakpoint storage and cross-device sync.

### Fixed
- Per-card styles now apply to the host element so background / radius / shadow are actually visible.
