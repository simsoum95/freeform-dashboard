# Changelog

All notable changes to this project are documented here.

## [Canvas Board 1.4] - 2026-06-17
### Added
- **New companion component: `shimon-canvas-board`** — a *card* (not an overlay) you place in a view that holds any cards at fixed free `(x, y, w, h)` positions inside its own container, so the layout is **faithful on reload by construction**. Use it when you want a dedicated free-layout view rather than an overlay on an existing dashboard.
  - Free **drag & resize** (independent width/height), **multi-select**, **undo**.
  - **Content hug / scale** — a card scales to fit its box; whitespace collapses before the content shrinks; clocks & labels never clip.
  - **Per-card 🗑 delete** and **✎ edit** that opens Home Assistant's **native** card editor (settings + code), with a YAML-editor fallback.
  - **Cameras / media** render as stable fixed-size boxes.
  - **Cross-device save** to the dashboard config; instant per-device drafts in `localStorage`.
  - Dependency-free single file `shimon-canvas-board.js`; see the README for install + config.

## [7.0.3] - 2026-06-14
### Changed
- Packaging/CI only — added the HACS validation workflow and listed the project for HACS. No changes to the editor itself.

## [7.0.2] - 2026-06-14
### Fixed
- **Enlarging a card grew the frame more than the content** — making a card bigger left empty space around the content (a wide clock in a taller box looked like "the frame grew but the clock didn't"). On release, the frame now snaps to hug its scaled content, so enlarging grows what's *inside* the card with no blank margin around it. Shrink-to-fit (whitespace collapses first, then content) is unchanged.

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
