# Changelog

All notable changes to this project are documented here.

## [Canvas Board 1.11] - 2026-06-20
### Changed
- **Resizing is now a coherent, what-you-see-is-what-you-save zoom.** Two fixes to how a card's content tracks its box:
  - **The corner handle is a true uniform zoom.** It now locks the box to the content's own aspect ratio, so the content *fills* the box and grows/shrinks 1:1 with the drag — "the bigger I drag, the bigger everything gets." Previously the box kept whatever aspect it had, so the content was letterboxed and scaled by only the tighter dimension, which felt like it "didn't grow" when you enlarged. (Cameras/media keep their free rectangle.) The right- and bottom-edge handles still reshape width or height independently.
  - **The live preview now matches the saved result.** Removed the whitespace-collapse "compact" ramp: it made shrinking non-linear and relied on a separately-measured tight height (timing-sensitive), so a card could settle at a different size after saving than what you saw while dragging. Content now scales uniformly in both directions, identically in the editor and after save.

## [Canvas Board 1.10] - 2026-06-20
### Fixed
- **A news ticker (or any list with its own scrolling/clipping) no longer spills out of its box.** The "no-clip" helper — which forces a card's content to show in full, meant for short single-line cards like clocks that clip themselves sideways — was being injected into *every* button-card, including tall cards that have their *own* intentional `overflow:hidden` (a news feed, an entities list). That override defeated their internal clipping, so all the rows rendered at once and overflowed past the card's header. The override is now **gated by the card's measured height** at every injection site and is **removed** as soon as a card turns out to be tall — so short clip-prone labels still show in full, while tall self-clipping cards keep their own scrolling viewport inside the box.

## [Canvas Board 1.9] - 2026-06-20
### Changed
- **One button to finish.** The separate "save to all devices" button is gone. The edit toggle now reads **✓ Done & Save** while editing — clicking it exits edit mode *and* saves the layout to every device in one action. No more choosing between several save options.

### Fixed
- **What you resize is what you get — live.** While dragging a card's resize handle (or moving it), the content now scales to fit the box **as you drag**, so you can see exactly what you're enlarging or shrinking. Previously the content only snapped to the right scale *after* you saved, so text could appear to spill out of the frame mid-resize (especially in right-to-left layouts). The card now re-measures its natural size at the start of every resize, so the live preview matches the saved result.

## [Canvas Board 1.8] - 2026-06-17
### Changed
- **Edit mode is now responsive too.** The board scales to fit the viewport in **both view and edit**, so anyone can arrange it from their own (smaller / right-to-left) screen — drag, resize and rubber-band coordinates are corrected for the scale so a card follows the cursor 1:1. No-op when the screen is already wide.

## [Canvas Board 1.7] - 2026-06-17
### Added
- **Responsive — the board scales to fit any screen.** In view mode the whole board is uniformly scaled so its design width fits the viewport, so a fixed-pixel layout **adapts to smaller screens (and right-to-left UIs)** instead of overflowing. Edit mode stays 1:1 so drag/resize coordinates remain pixel-exact (the owner can scroll while arranging). No-op when the screen is already wide enough.

## [Canvas Board 1.6] - 2026-06-17
### Added
- **➕ Add-card button** on the board (in edit mode) — opens Home Assistant's **native card picker** (visual + code), and the chosen card is dropped on the board, draggable. Falls back to a YAML editor if the native dialog isn't available.

### Fixed
- **Tall cards (a news / entities list, etc.) no longer overflow their box.** The "no-clip" behaviour (visible overflow + natural width — meant for short single-line cards like clocks that clip sideways) now applies **only to short cards**; tall content scales to fit and clips to its box instead of spilling over its neighbours.
- The clock no-clip is now CSS-driven (`.item.noclip > .card-host`) and uses `width:max-content`, so a clock can't flash clipped even before the fit-scale settles.

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
