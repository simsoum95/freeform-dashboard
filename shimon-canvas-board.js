/**
 * shimon-canvas-board.js  v0.2
 *
 * A SELF-CONTAINED free-canvas board for Lovelace. One board card holds N child
 * cards, each absolutely positioned at a fixed (x, y) INSIDE the board's own
 * positioned container — faithful on reload BY CONSTRUCTION (positions are
 * absolute coordinates, never an offset on a moving flow).
 *
 * v0.2 — CONTENT SCALING (the "fit"/hug behaviour):
 *   • each card hugs its content (no empty frame) — the box height follows the
 *     content's real height, measured via offsetHeight (transform-independent)
 *   • resizing ZOOMS the content (transform: scale) instead of just stretching
 *     an empty frame — enlarge → content grows; shrink → the box hugs tighter
 *   • the card's layout width is pinned so the content never reflows while
 *     zooming; a ResizeObserver keeps the box hugging late/dynamic content
 *
 * Identity & reload: an item is keyed by its index in THIS board (stable). The
 * stored value is {x, y, w} where w is the SCALED box width; scale = w / natW
 * (natW = the card's base layout width from config). A camera that oscillates in
 * height just re-hugs; it can never push another card (everything is absolute).
 *
 * Config:
 *   type: custom:shimon-canvas-board
 *   board_id: test
 *   height: 900            # optional; auto-fits to content if omitted
 *   items:
 *     - { x: 16, y: 16, w: 320, card: { type: entity, entity: sun.sun } }   # w = base layout width
 *
 * Persistence: localStorage per (dashboard path, board_id, item index) — instant
 * + reload-faithful on the device. (Cross-device "save to config" is next.)
 */
(function () {
  'use strict';
  const GRID = 4, MIN_S = 0.4, MAX_S = 4, PAD = 40;
  const snap = (n) => Math.round(n / GRID) * GRID;
  // Compact CSS at intensity k (0 = loose/natural, 1 = fully tight): collapses a
  // card's internal whitespace (padding, row air, line-height) WITHOUT shrinking
  // its content. Interpolated so the collapse is GRADUAL as you resize.
  function compactCSS(k) {
    if (k <= 0.01) return '';
    const pad = Math.max(0, Math.round(16 - 14 * k));
    const lh = (1.55 - 0.45 * k).toFixed(2);
    const rmin = Math.max(0, Math.round(40 - 20 * k));
    return `ha-card{padding:${pad}px ${pad + 4}px!important}.card-content,.header{padding:0!important}`
         + `#states>*,.entity,[class*="row"],hui-generic-entity-row,state-badge,.flex,.entities-row{min-height:${rmin}px!important}`
         + `*{line-height:${lh}!important}`;
  }

  const posKey = (b, i) => `shimon-board:${location.pathname.split('?')[0]}:${b}:${i}`;
  const editKey = (b) => `shimon-board-edit:${location.pathname.split('?')[0]}:${b}`;
  const loadPos = (b, i) => { try { const r = localStorage.getItem(posKey(b, i)); return r ? JSON.parse(r) : null; } catch { return null; } };
  const savePos = (b, i, p) => { try { localStorage.setItem(posKey(b, i), JSON.stringify(p)); } catch {} };

  class ShimonCanvasBoard extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._children = []; this._built = false; this._edit = false; this._undo = []; this._sel = new Set(); }

    setConfig(config) {
      if (!config || !Array.isArray(config.items)) throw new Error('shimon-canvas-board: `items` (array) is required');
      this._config = config;
      this._boardId = config.board_id || 'board';
      this._urlPath = config.url_path || (location.pathname.split('/').filter(Boolean)[0]) || 'lovelace';
      this._height = config.height || null;
      this._items = config.items.map((it, i) => {
        const baseW = it.w || 280;                    // configured base box width
        const saved = loadPos(this._boardId, i) || {};
        const ctype = (it.card && it.card.type) || '';
        const fixed = it.fixed === true || /camera|webrtc|picture|image|iframe|video/i.test(ctype);
        const noclip = it.noclip === true || (it.noclip !== false && /button-card|clock/i.test(ctype));   // auto: clocks / button-cards often clip their own content
        return {
          card: it.card, idx: i, baseW, natW: baseW, noclip, fixed, compact: (it.compact !== false) && !fixed,  // fixed: camera/media fills the box; compact: collapse whitespace; noclip: don't self-clip
          natH: it.h || 0, natHtight: 0,              // measured at runtime (loose + compact content heights)
          pos: { x: saved.x != null ? saved.x : (it.x || 0), y: saved.y != null ? saved.y : (it.y || 0), w: saved.w != null ? saved.w : baseW, h: saved.h != null ? saved.h : (it.h || 0) },
        };
      });
      try { this._edit = localStorage.getItem(editKey(this._boardId)) === '1'; } catch {}
      if (!this._built) this._build(); else { this._renderItems(); this._applyEditMode(); }
    }

    set hass(hass) { this._hass = hass; this._children.forEach(c => { if (c.el) c.el.hass = hass; }); }
    getCardSize() { return this._height ? Math.ceil(this._height / 50) : 10; }

    async _build() {
      this._built = true;
      const sh = this.shadowRoot;
      sh.innerHTML = `
        <style>
          :host { display:block; }
          .board { position:relative; width:100%; min-height:120px; }
          .item { position:absolute; box-sizing:border-box; }
          .item > .card-host { position:absolute; inset:0; overflow:hidden; border-radius:18px; }
          .item.noclip > .card-host { overflow:visible!important; }   /* clock/label: never clip, from the very first frame */
          .item > .card-host > * { display:block; }
          .item > .cover { position:absolute; inset:0; display:none; z-index:5;
            border:2px dashed rgba(120,170,255,.9); border-radius:18px;
            background:rgba(120,170,255,.08); cursor:grab; }
          .item > .cover:active { cursor:grabbing; }
          .item > .rz { position:absolute; right:-3px; bottom:-3px; width:30px; height:30px;
            display:none; z-index:7; cursor:nwse-resize; touch-action:none;
            background:radial-gradient(circle at 72% 72%, #1e5aa6 0 8px, transparent 9px); }
          .item > .rz-r, .item > .rz-b { position:absolute; display:none; z-index:6; touch-action:none;
            background:rgba(30,90,166,.55); border-radius:6px; }
          .item > .rz-r { top:25%; bottom:25%; right:-5px; width:10px; cursor:ew-resize; }
          .item > .rz-b { left:25%; right:25%; bottom:-5px; height:10px; cursor:ns-resize; }
          :host(.editing) .item > .cover { display:block; }
          :host(.editing) .item > .rz,
          :host(.editing) .item > .rz-r,
          :host(.editing) .item > .rz-b { display:block; }
          .item > .tools { position:absolute; top:6px; right:6px; z-index:9; display:none; gap:6px; }
          :host(.editing) .item > .tools { display:flex; }
          .item > .tools > button { width:32px; height:32px; padding:0; border:none; border-radius:50%;
            cursor:pointer; font:16px/32px system-ui,sans-serif; text-align:center; color:#fff;
            box-shadow:0 2px 8px rgba(0,0,0,.45); }
          .item > .tools > .edit-card { background:#1e5aa6; }
          .item > .tools > .del-card { background:#c0392b; }
          .item > .tools > button:hover { filter:brightness(1.12); }
          .item.active > .cover { background:rgba(120,170,255,.18); box-shadow:0 12px 36px rgba(0,0,0,.35); }
          .item.selected > .cover { display:block; border-color:#f5a623; border-style:solid; background:rgba(245,166,35,.16); }
          .marquee { position:absolute; z-index:40; border:1.5px solid #f5a623; background:rgba(245,166,35,.12); pointer-events:none; display:none; }
          .bar { position:sticky; top:0; z-index:50; display:flex; gap:8px; justify-content:flex-end;
            align-items:center; padding:6px 8px; pointer-events:none; }
          .bar > * { pointer-events:auto; }
          .btn { padding:8px 14px; border-radius:20px; border:none; font:600 14px/1 system-ui,sans-serif;
            cursor:pointer; color:#fff; background:#1e5aa6; box-shadow:0 3px 10px rgba(0,0,0,.3); }
          .btn.undo { background:#6b7280; display:none; }
          .btn.save { background:#2e9e5b; display:none; }
          .btn.add { background:#7b3fa0; display:none; }
          :host(.editing) .edit { background:#2e9e5b; }
          :host(.editing) .btn.undo, :host(.editing) .btn.save, :host(.editing) .btn.add { display:inline-block; }
          .hint { margin-inline-end:auto; font:500 13px/1.3 system-ui,sans-serif; color:#2e9e5b; display:none; }
          :host(.editing) .hint { display:block; }
        </style>
        <div class="bar">
          <span class="hint">עריכה — גרור להזזה · פינה/צד לגודל · לחץ לבחור · Shift או סימון לקבוצה</span>
          <button class="btn add" type="button">➕ כרטיס</button>
          <button class="btn undo" type="button">↶ ביטול</button>
          <button class="btn edit" type="button"></button>
        </div>
        <div class="board"></div>
      `;
      this._boardEl = sh.querySelector('.board');
      this._marqueeEl = document.createElement('div'); this._marqueeEl.className = 'marquee'; this._boardEl.appendChild(this._marqueeEl);
      this._boardEl.addEventListener('pointerdown', (e) => { if (e.target === this._boardEl) this._beginMarquee(e); });
      sh.querySelector('.edit').addEventListener('click', () => this._toggleEdit());
      sh.querySelector('.undo').addEventListener('click', () => this.undo());
      sh.querySelector('.add').addEventListener('click', () => this._addCard());
      this._helpers = await window.loadCardHelpers();
      await this._renderItems();
      this._applyEditMode();
      this._startHeartbeat();
      try { this._ro = new ResizeObserver(() => this._fitBoard()); this._ro.observe(this); } catch (e) {}
    }

    async _renderItems() {
      if (!this._boardEl) return;
      for (let i = 0; i < this._items.length; i++) {
        if (!this._children[i]) {
          const it = this._items[i];
          const itemEl = document.createElement('div'); itemEl.className = 'item' + (it.noclip ? ' noclip' : '');
          const host = document.createElement('div'); host.className = 'card-host';
          const cover = document.createElement('div'); cover.className = 'cover';
          const rz = document.createElement('div'); rz.className = 'rz';
          const rzR = document.createElement('div'); rzR.className = 'rz-r';
          const rzB = document.createElement('div'); rzB.className = 'rz-b';
          const tools = document.createElement('div'); tools.className = 'tools';
          const bEdit = document.createElement('button'); bEdit.className = 'edit-card'; bEdit.type = 'button'; bEdit.title = 'ערוך כרטיס (הגדרות + קוד)'; bEdit.textContent = '✎';
          const bDel = document.createElement('button'); bDel.className = 'del-card'; bDel.type = 'button'; bDel.title = 'מחק כרטיס'; bDel.textContent = '🗑';
          tools.append(bEdit, bDel);
          itemEl.append(host, cover, rz, rzR, rzB, tools);
          this._boardEl.appendChild(itemEl);
          const entry = { itemEl, host, cover, rz, rzR, rzB, el: null };
          this._children[i] = entry;
          const at = () => this._children.indexOf(entry);   // live index — survives delete/reorder
          let el = null;
          try { el = await this._helpers.createCardElement(it.card); }
          catch (e) { el = document.createElement('ha-card'); el.textContent = 'card error: ' + e.message; }
          if (this._hass) el.hass = this._hass;
          el.style.width = it.noclip ? 'max-content' : (it.natW + 'px');   // noclip → natural width (can't self-clip); else pin (no reflow while zooming)
          el.style.height = 'auto';
          host.appendChild(el);
          entry.el = el;
          if (it.noclip) this._applyNoClip(el);
          if (it.fixed) this._ensureFixed(i);
          else if (it.compact) this._ensureCompact(i);
          cover.addEventListener('pointerdown', (e) => this._beginDrag(e, at()));
          rz.addEventListener('pointerdown', (e) => this._beginResize(e, at(), 'both'));
          rzR.addEventListener('pointerdown', (e) => this._beginResize(e, at(), 'w'));
          rzB.addEventListener('pointerdown', (e) => this._beginResize(e, at(), 'h'));
          bEdit.addEventListener('click', (e) => { e.stopPropagation(); this._editCard(at()); });
          bDel.addEventListener('click', (e) => { e.stopPropagation(); this._deleteCard(at()); });
          // Keep the box hugging the content as it renders (late cameras, dynamic values).
          try { const ro = new ResizeObserver(() => this._measure(at())); ro.observe(el); } catch {}
          requestAnimationFrame(() => this._measure(i));
          setTimeout(() => this._measure(i), 600);
        }
        this._applyItem(i);
      }
      this._fitHeight();
    }

    _measure(i) {
      const it = this._items[i], e = this._children[i];
      if (!it || !e || !e.el || this._measuring || it.fixed) return;
      this._measuring = true;
      const el = e.el, t0 = el.style.transform;
      el.style.transform = 'none';
      // Does the content WRAP? Height drops a lot when given much more width →
      // it's wrapping text → keep the configured width. Otherwise (single-line
      // content like a clock) lay it out at its inline-block shrink-to-fit width
      // so it's shown at its natural size, never squeezed.
      el.style.display = ''; el.style.width = it.baseW + 'px'; el.style.height = 'auto';
      const h1 = el.offsetHeight;
      el.style.width = '4000px';
      const wraps = h1 > el.offsetHeight * 1.4;
      let natW;
      if (wraps) { natW = it.baseW; }
      else { el.style.display = 'inline-block'; el.style.width = 'auto'; natW = Math.max(it.baseW, Math.ceil(el.offsetWidth) + 2); }
      el.style.display = ''; el.style.width = natW + 'px'; el.style.height = 'auto';
      let natH, natHtight = it.natHtight;
      if (it.compact) {
        this._ensureCompact(i);
        const c = this._children[i];
        const k0 = c._compactK || 0;
        (c._compactStyles || []).forEach(s => s.textContent = '');                 // OFF → measure the LOOSE height
        natH = Math.ceil(el.offsetHeight) || it.natH || 60;
        (c._compactStyles || []).forEach(s => s.textContent = compactCSS(1));      // FULL → measure the TIGHT height
        natHtight = Math.ceil(el.offsetHeight) || natH;
        (c._compactStyles || []).forEach(s => s.textContent = compactCSS(k0));     // restore current level
      } else {
        natH = Math.ceil(el.offsetHeight) || it.natH || 60;
      }
      el.style.transform = t0;
      this._measuring = false;
      if (natW !== it.natW || Math.abs(natH - it.natH) > 1 || natHtight !== it.natHtight) {
        it.natW = natW; it.natH = natH; it.natHtight = natHtight;
        if (!it.pos.h) it.pos.h = natH;     // first time: box height hugs the content
        this._applyItem(i); this._fitHeight();
      }
    }

    // Override a card that clips/ellipsis-es its own content (opt-in via
    // item.noclip), so the full content shows. Opt-in so it never breaks cards
    // that legitimately truncate long labels. Re-runs once for late shadow roots.
    _applyNoClip(el) {
      const css = ':host,*{overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important;max-width:none!important;}';
      const inject = (node, d) => {
        if (d > 20 || !node) return;
        if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-sf-noclip]')) {
          const s = document.createElement('style'); s.setAttribute('data-sf-noclip', '1'); s.textContent = css; node.shadowRoot.appendChild(s);
          inject(node.shadowRoot, d + 1);
        }
        const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const x of all) if (x.shadowRoot) inject(x, d + 1);
      };
      inject(el, 0);   // re-applied by the heartbeat too, so a late/rebuilt shadow never loses it
    }

    // Insert a (toggleable) compact stylesheet into the card's shadow roots.
    // Toggled by textContent so it's reliable across browsers (style.disabled
    // isn't). Idempotent: skips roots that already have one.
    _ensureCompact(i) {
      const e = this._children[i]; if (!e || !e.el) return;
      e._compactStyles = e._compactStyles || [];
      const css = compactCSS(e._compactK || 0);
      const inject = (node, d) => {
        if (d > 20 || !node) return;
        if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-sf-compact]')) {
          const s = document.createElement('style'); s.setAttribute('data-sf-compact', '1'); s.textContent = css;
          node.shadowRoot.appendChild(s); e._compactStyles.push(s);
          inject(node.shadowRoot, d + 1);
        }
        const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const x of all) if (x.shadowRoot) inject(x, d + 1);
      };
      inject(e.el, 0);
    }
    // Set the compact intensity (0 = loose .. 1 = fully tight). Gradual.
    _setCompactLevel(i, k) {
      const e = this._children[i]; if (!e) return;
      this._ensureCompact(i);
      k = Math.max(0, Math.min(1, k));
      if (e._compactK != null && Math.abs(e._compactK - k) < 0.02) return;
      e._compactK = k;
      const css = compactCSS(k);
      (e._compactStyles || []).forEach(s => { s.textContent = css; });
    }

    // Make a camera/media card fill its box (object-fit cover) so its own
    // oscillating intrinsic height never matters — the box is the user's W×H.
    _ensureFixed(i) {
      const e = this._children[i]; if (!e || !e.el) return;
      const css = ':host{display:block;width:100%;height:100%}ha-card{width:100%!important;height:100%!important;overflow:hidden;border-radius:inherit;margin:0!important}video,img,canvas{object-fit:cover!important;width:100%!important;height:100%!important;display:block}';
      const inject = (node, d) => {
        if (d > 20 || !node) return;
        if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-sf-fixed]')) {
          const s = document.createElement('style'); s.setAttribute('data-sf-fixed', '1'); s.textContent = css; node.shadowRoot.appendChild(s);
          inject(node.shadowRoot, d + 1);
        }
        const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const x of all) if (x.shadowRoot) inject(x, d + 1);
      };
      inject(e.el, 0);   // re-applied by the heartbeat too
    }

    // Heartbeat: keep re-applying no-clip / fixed-fill into cards whose shadow
    // renders late or rebuilds (e.g. a clock updating every second) so they NEVER
    // flash clipped. Fast early, slow after, stops when detached.
    _startHeartbeat() {
      if (this._hbT) return;
      let beat = 0;
      const hb = () => { this._heartbeat(); beat++; this._hbT = setTimeout(hb, beat < 12 ? 600 : 2500); };
      this._hbT = setTimeout(hb, 350);
    }
    _heartbeat() {
      for (let i = 0; i < this._children.length; i++) {
        const e = this._children[i], it = this._items[i];
        if (!e || !e.el || !e.el.isConnected) continue;
        if (it.noclip && ((it.natH || 0) === 0 || it.natH < 130)) this._applyNoClip(e.el);
        else if (it.fixed) this._ensureFixed(i);
      }
    }
    connectedCallback() { if (this._built) this._startHeartbeat(); }
    disconnectedCallback() { if (this._hbT) { clearTimeout(this._hbT); this._hbT = null; } }

    _applyItem(i) {
      const it = this._items[i], e = this._children[i]; if (!e || !e.el) return;
      if (it.fixed) {                                    // camera/media: FILL the box (no hug, no scale, no compact) — stable height
        this._ensureFixed(i);
        e.el.style.transform = 'none'; e.el.style.transformOrigin = 'top left';
        e.el.style.width = '100%'; e.el.style.height = '100%';
        e.itemEl.style.left = it.pos.x + 'px'; e.itemEl.style.top = it.pos.y + 'px';
        e.itemEl.style.width = Math.max(8, it.pos.w) + 'px';
        e.itemEl.style.height = Math.max(8, it.pos.h || 200) + 'px';
        return;
      }
      const natW = it.natW || 60, natH = it.natH || 60, tightH = it.natHtight || natH;
      const W = it.pos.w, H = it.pos.h || natH;          // FREE box: width and height independent
      // The content fits INSIDE the box, scaled uniformly (no distortion). As the
      // box shrinks below natural, first collapse the internal whitespace (compact
      // ramp → readable content stays large), then the uniform scale finishes.
      let fit = Math.min(W / natW, H / natH);
      let k = 0;
      if (it.compact && tightH < natH - 1) {
        k = Math.max(0, Math.min(1, (1 - fit) * 1.4));
        this._setCompactLevel(i, k);
        const effH = natH - (natH - tightH) * k;          // content height after collapsing whitespace
        fit = Math.min(W / natW, H / effH);
      }
      const scale = Math.max(0.05, Math.min(MAX_S, fit));
      // no-clip (natural width + visible overflow) is for SHORT single-line cards
      // (clocks/labels) that clip themselves sideways — NOT for tall content like a
      // news list, which must scale-to-fit and clip to its box. natH 0 = not measured
      // yet → treat as clock-like so a real clock never flashes clipped on first paint.
      const nc = it.noclip && ((it.natH || 0) === 0 || it.natH < 130);
      e.el.style.transformOrigin = 'top left';
      e.el.style.transform = `scale(${scale})`;
      e.el.style.width = nc ? 'max-content' : (natW + 'px');
      e.el.style.height = 'auto';
      e.itemEl.style.left = it.pos.x + 'px';
      e.itemEl.style.top = it.pos.y + 'px';
      e.itemEl.style.width = Math.max(8, W) + 'px';
      e.itemEl.style.height = Math.max(8, H) + 'px';
      // Clock-like card: host shows overflow so it never clips, even before the scale
      // settles. A tall card keeps overflow hidden so its content clips to its box
      // (scaled to fit) instead of spilling over its neighbours.
      if (e.host) e.host.style.overflow = nc ? 'visible' : '';
      if (e.itemEl) e.itemEl.classList.toggle('noclip', nc);
    }

    _fitHeight() {
      let maxR = 0, maxB = 0;
      for (let i = 0; i < this._items.length; i++) { const it = this._items[i]; maxR = Math.max(maxR, it.pos.x + (it.pos.w || it.natW || 60)); maxB = Math.max(maxB, it.pos.y + (it.pos.h || it.natH || 60)); }
      this._designW = maxR + 24;
      const h = this._height || (maxB + PAD);
      this._designH = h;
      this._boardEl.style.height = h + 'px';
      this._fitBoard();
    }

    // Responsive: uniformly scale the whole board so its design width fits the
    // viewport — fixed-pixel layouts then adapt to ANY screen, LTR or RTL, in BOTH
    // view AND edit (so anyone can edit from their own screen). Drag/resize/marquee
    // divide their screen-pixel deltas by this._fitScale so they stay pixel-exact.
    // No-op when the screen is already wide enough.
    _fitBoard() {
      if (!this._boardEl || !this._designW) return;
      const avail = this.getBoundingClientRect().width || this._designW;
      const fit = Math.max(0.25, Math.min(1, avail / this._designW));   // scale in BOTH view & edit, so anyone can edit from their own screen; drag/resize divide deltas by this
      this._fitScale = fit;
      this._boardEl.style.transformOrigin = 'top left';
      this._boardEl.style.transform = fit < 0.999 ? `scale(${fit})` : 'none';
      this._boardEl.style.marginBottom = (fit < 0.999 && this._designH) ? `${Math.round(-this._designH * (1 - fit))}px` : '';
    }

    _toggleEdit() { const was = this._edit; this._edit = !this._edit; try { localStorage.setItem(editKey(this._boardId), this._edit ? '1' : '0'); } catch {} this._applyEditMode(); if (was && !this._edit) this._saveToConfig(); }   // finishing edit → auto-save to all devices
    _applyEditMode() { this.classList.toggle('editing', this._edit); const b = this.shadowRoot.querySelector('.edit'); if (b) b.textContent = this._edit ? '✓ סיום ושמירה' : '✎ עריכה'; if (!this._edit) { this._sel.clear(); this._renderSelection(); } this._fitBoard(); }

    _beginDrag(e, i) {
      if (!this._edit) return;
      e.preventDefault(); e.stopPropagation();
      const en = this._children[i];
      try { en.cover.setPointerCapture(e.pointerId); } catch {}
      const sx = e.clientX, sy = e.clientY, shift = e.shiftKey;
      // Move the WHOLE selection if this card is part of a multi-selection.
      const group = (this._sel.has(i) && this._sel.size > 1) ? [...this._sel] : [i];
      const starts = group.map(g => ({ g, x: this._items[g].pos.x, y: this._items[g].pos.y }));
      let moved = false, pushed = false;
      const move = (ev) => {
        const s2 = this._fitScale || 1; const dx = (ev.clientX - sx) / s2, dy = (ev.clientY - sy) / s2;   // screen px → board px (so drag/resize stay exact when the board is scaled to fit a smaller screen)
        if (!moved && Math.hypot(dx, dy) > 4) { moved = true; if (!pushed) { this._pushUndo(group); pushed = true; } en.itemEl.classList.add('active'); }
        if (!moved) return;
        for (const s of starts) { const it = this._items[s.g]; it.pos.x = Math.max(0, snap(s.x + dx)); it.pos.y = Math.max(0, snap(s.y + dy)); this._applyItem(s.g); }
      };
      const end = () => {
        en.cover.removeEventListener('pointermove', move); en.cover.removeEventListener('pointerup', end); en.cover.removeEventListener('pointercancel', end);
        en.itemEl.classList.remove('active');
        if (!moved) {                                    // a click → select / toggle
          if (shift) { this._sel.has(i) ? this._sel.delete(i) : this._sel.add(i); }
          else { this._sel.clear(); this._sel.add(i); }
        } else {                                         // a drag → keep selection sane + persist
          if (group.length === 1) { this._sel.clear(); this._sel.add(i); }
          for (const s of starts) savePos(this._boardId, s.g, this._items[s.g].pos);
        }
        this._renderSelection(); this._fitHeight();
      };
      en.cover.addEventListener('pointermove', move); en.cover.addEventListener('pointerup', end); en.cover.addEventListener('pointercancel', end);
    }

    // mode: 'both' (corner — free W & H), 'w' (right edge), 'h' (bottom edge).
    _beginResize(e, i, mode) {
      if (!this._edit) return;
      e.preventDefault(); e.stopPropagation();
      const en = this._children[i];
      const handle = mode === 'w' ? en.rzR : mode === 'h' ? en.rzB : en.rz;
      try { handle.setPointerCapture(e.pointerId); } catch {}
      en.itemEl.classList.add('active');
      // Resize the WHOLE selection together (proportional) if this card is in it.
      const group = (this._sel.has(i) && this._sel.size > 1) ? [...this._sel] : [i];
      for (const g of group) this._measure(g);   // refresh natW/natH so the LIVE resize scales the content correctly — was only right after a save re-render
      this._pushUndo(group);
      const starts = group.map(g => ({ g, w: this._items[g].pos.w, h: this._items[g].pos.h || (this._items[g].natH || 60) }));
      const sx = e.clientX, sy = e.clientY;
      const startW = en.itemEl.offsetWidth || this._items[i].pos.w;
      const startH = en.itemEl.offsetHeight || this._items[i].pos.h || (this._items[i].natH || 60);
      const move = (ev) => {
        const s2 = this._fitScale || 1; const dx = (ev.clientX - sx) / s2, dy = (ev.clientY - sy) / s2;   // screen px → board px (so drag/resize stay exact when the board is scaled to fit a smaller screen)
        const fw = mode !== 'h' ? Math.max(40, startW + dx) / startW : 1;
        const fh = mode !== 'w' ? Math.max(30, startH + dy) / startH : 1;
        const fBoth = Math.max(fw, fh);                 // corner: one uniform factor for the group
        for (const s of starts) {
          const it = this._items[s.g];
          if (mode === 'both') { it.pos.w = snap(Math.max(40, s.w * fBoth)); it.pos.h = snap(Math.max(30, s.h * fBoth)); }
          else if (mode === 'w') { it.pos.w = snap(Math.max(40, s.w * fw)); }
          else { it.pos.h = snap(Math.max(30, s.h * fh)); }
          this._applyItem(s.g);
        }
      };
      const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); en.itemEl.classList.remove('active'); for (const s of starts) savePos(this._boardId, s.g, this._items[s.g].pos); this._fitHeight(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    }

    _pushUndo(indices) { const arr = Array.isArray(indices) ? indices : [indices]; this._undo.push(arr.map(i => ({ i, pos: Object.assign({}, this._items[i].pos) }))); if (this._undo.length > 50) this._undo.shift(); }
    undo() {
      const last = this._undo.pop(); if (!last) return false;
      let structural = false;
      for (const e of last) {
        if (e.remove) { this._items.splice(e.index, 0, e.item); this._children.splice(e.index, 0, undefined); structural = true; }
        else { this._items[e.i].pos = e.pos; this._applyItem(e.i); savePos(this._boardId, e.i, e.pos); }
      }
      if (structural) { this._renderItems().then(() => { this._reindexDrafts(); this._saveToConfig(true); }); }
      this._fitHeight(); return true;
    }

    _renderSelection() { for (let i = 0; i < this._children.length; i++) { const c = this._children[i]; if (c && c.itemEl) c.itemEl.classList.toggle('selected', this._sel.has(i)); } }

    // Rubber-band on the empty board background → select the cards it touches.
    _beginMarquee(e) {
      if (!this._edit) return;
      e.preventDefault();
      const rect = this._boardEl.getBoundingClientRect();
      const s2 = this._fitScale || 1;
      const x0 = (e.clientX - rect.left) / s2, y0 = (e.clientY - rect.top) / s2;
      if (!e.shiftKey) this._sel.clear();
      this._renderSelection();
      const mq = this._marqueeEl; let moved = false;
      const move = (ev) => {
        const x1 = (ev.clientX - rect.left) / s2, y1 = (ev.clientY - rect.top) / s2;
        if (!moved && Math.hypot(x1 - x0, y1 - y0) > 4) { moved = true; mq.style.display = 'block'; }
        if (!moved) return;
        const L = Math.min(x0, x1), T = Math.min(y0, y1), R = Math.max(x0, x1), B = Math.max(y0, y1);
        mq.style.left = L + 'px'; mq.style.top = T + 'px'; mq.style.width = (R - L) + 'px'; mq.style.height = (B - T) + 'px';
        for (let i = 0; i < this._items.length; i++) {
          const p = this._items[i].pos, w = p.w, h = p.h || (this._items[i].natH || 60);
          if (p.x < R && p.x + w > L && p.y < B && p.y + h > T) this._sel.add(i);
        }
        this._renderSelection();
      };
      const end = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); mq.style.display = 'none'; this._renderSelection(); };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true);
    }

    // Bake the current layout into the dashboard config (cross-device, permanent
    // — survives a localStorage clear and shows on the uncle's iPad).
    async _saveToConfig(silent) {
      const hass = this._hass;
      if (!hass || !hass.callWS) { this._toast('HA לא זמין', true); return; }
      const up = (this._urlPath && this._urlPath !== 'lovelace') ? this._urlPath : null;
      try {
        if (!silent) this._toast('שומר…');
        const cfg = await hass.callWS(up ? { type: 'lovelace/config', url_path: up } : { type: 'lovelace/config' });
        let found = null; const want = this._boardId;
        const walk = (node) => {
          if (found || !node || typeof node !== 'object') return;
          if (Array.isArray(node)) { for (const n of node) walk(n); return; }
          if (node.type === 'custom:shimon-canvas-board' && (node.board_id || 'board') === want) { found = node; return; }
          for (const k of ['views', 'cards', 'sections', 'card']) if (node[k]) walk(node[k]);
        };
        walk(cfg);
        if (!found) { this._toast('הלוח לא נמצא בתצורה', true); return; }
        found.items = this._items.map((it) => {
          const o = { x: it.pos.x, y: it.pos.y, w: it.pos.w, h: it.pos.h, card: it.card };
          if (it.noclip) o.noclip = true;
          if (it.compact === false) o.compact = false;
          return o;
        });
        await hass.callWS(up ? { type: 'lovelace/config/save', url_path: up, config: cfg } : { type: 'lovelace/config/save', config: cfg });
        this._toast('✓ נשמר בכל המכשירים');
      } catch (e) {
        this._toast('שגיאה: ' + (e && e.message ? e.message : ''), true);
      }
    }
    _toast(msg, err) {
      const bar = this.shadowRoot && this.shadowRoot.querySelector('.bar'); if (!bar) return;
      let t = bar.querySelector('.toast');
      if (!t) { t = document.createElement('span'); t.className = 'toast'; t.style.cssText = 'margin-inline-end:auto;font:600 13px/1.3 system-ui,sans-serif;'; bar.insertBefore(t, bar.firstChild); }
      t.style.color = err ? '#c0392b' : '#2e9e5b'; t.textContent = msg;
      clearTimeout(this._toastT); this._toastT = setTimeout(() => { if (t) t.textContent = ''; }, 3500);
    }

    // ---- per-card editing (HA-native dialog, YAML fallback) + delete ----------

    async _editCard(i) {
      const it = this._items[i]; if (!it) return;
      const apply = async (newCard) => {
        if (!newCard || typeof newCard !== 'object') return;
        this._items[i].card = newCard;
        await this._recreateChild(i);
        this._fitHeight();
        this._saveToConfig(true);
        this._toast('✓ כרטיס עודכן');
      };
      await this._ensureNativeEditor();                                  // load HA's real editor if possible
      if (!this._openNativeCardEditor(it.card, apply)) this._openYamlEditor(it.card, apply);
    }

    // Lazy-load HA's native card-editor dialog by briefly toggling the dashboard's
    // own edit mode (the chunk stays registered afterwards). Lets ✎ open the REAL
    // HA editor (visual settings + code). No-op if already loaded; the YAML editor
    // is the fallback when this isn't possible.
    _ensureNativeEditor() {
      return new Promise((resolve) => {
        if (customElements.get('hui-dialog-edit-card')) return resolve();
        let panel = null, c = 0;
        try { (function walk(n, d) { if (d > 30 || !n || c > 40000 || panel) return; const kids = n.querySelectorAll ? n.querySelectorAll('*') : []; for (const k of kids) { if (panel) return; c++; const tag = (k.tagName || '').toLowerCase(); if ((tag === 'hui-root' || tag === 'ha-panel-lovelace') && k.lovelace) { panel = k; return; } if (k.shadowRoot) walk(k.shadowRoot, d + 1); } })(document, 0); } catch (e) {}
        const lov = panel && panel.lovelace;
        let done = false; const finish = () => { if (done) return; done = true; resolve(); };
        if (lov && typeof lov.setEditMode === 'function' && !lov.editMode) {
          try {
            lov.setEditMode(true);
            customElements.whenDefined('hui-dialog-edit-card').then(finish);
            setTimeout(() => { try { if (lov.editMode) lov.setEditMode(false); } catch (e) {} }, 700);
          } catch (e) { finish(); }
        }
        setTimeout(finish, 1600);   // safety: never hang the edit click
      });
    }

    // "+ Add card" — open HA's native card picker (visual + code) and drop the
    // chosen card on the board (draggable). YAML editor fallback if unavailable.
    async _addCard() {
      await this._ensureNativeEditor();
      const onPicked = (card) => this._appendItem(card);
      if (!this._openNativeCardPicker(onPicked)) this._openYamlEditor({ type: 'button', name: 'כרטיס חדש' }, onPicked);
    }

    _openNativeCardPicker(save) {
      try {
        if (!customElements.get('hui-dialog-create-card')) return false;
        const params = {
          lovelaceConfig: { views: [{ cards: [] }] },
          path: [0],
          saveConfig: (newLov) => { try { const cs = (newLov && newLov.views && newLov.views[0] && newLov.views[0].cards) || []; const card = cs[cs.length - 1]; if (card) save(card); } catch (e) {} },
        };
        this.dispatchEvent(new CustomEvent('show-dialog', {
          bubbles: true, composed: true,
          detail: { dialogTag: 'hui-dialog-create-card', dialogImport: () => Promise.resolve(), dialogParams: params },
        }));
        return true;
      } catch (e) { return false; }
    }

    // Build an item object (same shape as setConfig) for a freshly added card.
    _makeItem(card, pos) {
      pos = pos || {};
      const baseW = pos.w || 240, ctype = (card && card.type) || '';
      const fixed = /camera|webrtc|picture|image|iframe|video/i.test(ctype);
      const noclip = /button-card|clock/i.test(ctype);
      return { card, idx: -1, baseW, natW: baseW, noclip, fixed, compact: !fixed, natH: 0, natHtight: 0,
        pos: { x: pos.x != null ? pos.x : 32, y: pos.y != null ? pos.y : 32, w: baseW, h: pos.h || 0 } };
    }

    async _appendItem(card) {
      if (!card || typeof card !== 'object') return;
      const it = this._makeItem(card), index = this._items.length;
      this._undo.push([{ remove: true, index, item: it }]); if (this._undo.length > 50) this._undo.shift();
      this._items.push(it); this._children.push(undefined);
      await this._renderItems();
      this._reindexDrafts();
      this._saveToConfig(true);
      this._sel.clear(); this._sel.add(index); this._renderSelection(); this._fitHeight();
      this._toast('✓ כרטיס נוסף — גרור למקום הרצוי');
    }

    // Open HA's REAL card editor (visual settings + code) for a card that lives
    // INSIDE this board, by wrapping it in a throwaway one-card lovelace and
    // harvesting the edited card from the save callback. Returns false if the
    // native dialog isn't registered in this HA build → caller uses the fallback.
    _openNativeCardEditor(card, save) {
      try {
        if (!customElements.get('hui-dialog-edit-card')) return false;
        const lovelaceConfig = { views: [{ title: ' ', cards: [JSON.parse(JSON.stringify(card))] }] };
        const params = {
          lovelaceConfig,
          path: [0, 0],
          saveConfig: (newLov) => { try { save(newLov && newLov.views && newLov.views[0] && newLov.views[0].cards && newLov.views[0].cards[0]); } catch (e) {} },
        };
        this.dispatchEvent(new CustomEvent('show-dialog', {
          bubbles: true, composed: true,
          detail: { dialogTag: 'hui-dialog-edit-card', dialogImport: () => Promise.resolve(), dialogParams: params },
        }));
        return true;
      } catch (e) { return false; }
    }

    // Fallback per-card editor: HA's own <ha-yaml-editor> (real code editing), or a
    // plain textarea if that element isn't registered. Pure standard Lovelace config.
    _openYamlEditor(card, save) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--ha-card-background,var(--card-background-color,#1f2430));color:var(--primary-text-color,#fff);width:min(680px,92vw);max-height:88vh;overflow:auto;border-radius:16px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.6);';
      const title = document.createElement('div');
      title.textContent = '✎ עריכת כרטיס (קוד YAML)';
      title.style.cssText = 'font:700 18px system-ui,sans-serif;margin-bottom:14px;';
      let ed, getVal;
      if (customElements.get('ha-yaml-editor')) {
        ed = document.createElement('ha-yaml-editor');
        if (this._hass) ed.hass = this._hass;
        ed.defaultValue = card;
        getVal = () => ed.value;
      } else {
        ed = document.createElement('textarea');
        ed.style.cssText = 'width:100%;height:340px;font:13px/1.4 monospace;box-sizing:border-box;';
        ed.value = JSON.stringify(card, null, 2);
        getVal = () => JSON.parse(ed.value);
      }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
      const mkBtn = (txt, bg) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = 'padding:9px 18px;border:none;border-radius:20px;cursor:pointer;color:#fff;font:600 14px system-ui,sans-serif;background:' + bg + ';'; return b; };
      const cancel = mkBtn('ביטול', '#6b7280'), ok = mkBtn('שמור', '#2e9e5b');
      const close = () => { try { ov.remove(); } catch (e) {} };
      cancel.addEventListener('click', close);
      ok.addEventListener('click', () => { let v; try { v = getVal(); } catch (e) { this._toast('קוד לא תקין', true); return; } if (v == null || typeof v !== 'object') { this._toast('קוד לא תקין', true); return; } close(); save(v); });
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      row.append(cancel, ok); box.append(title, ed, row); ov.appendChild(box); document.body.appendChild(ov);
    }

    // Re-create a child card element in place (after its config was edited).
    async _recreateChild(i) {
      const en = this._children[i], it = this._items[i]; if (!en || !it) return;
      try { if (en.el) en.el.remove(); } catch (e) {}
      en._compactStyles = [];
      const ctype = (it.card && it.card.type) || '';
      it.fixed = it.fixed === true || /camera|webrtc|picture|image|iframe|video/i.test(ctype);
      it.noclip = it.noclip === true || /button-card|clock/i.test(ctype);
      en.itemEl.classList.toggle('noclip', !!it.noclip);
      let el;
      try { el = await this._helpers.createCardElement(it.card); }
      catch (e) { el = document.createElement('ha-card'); el.textContent = 'card error: ' + e.message; }
      if (this._hass) el.hass = this._hass;
      el.style.width = it.noclip ? 'max-content' : ((it.natW || it.baseW) + 'px'); el.style.height = 'auto';
      en.host.appendChild(el); en.el = el;
      if (it.noclip) this._applyNoClip(el);
      if (it.fixed) this._ensureFixed(i); else if (it.compact) this._ensureCompact(i);
      try { const ro = new ResizeObserver(() => this._measure(this._children.indexOf(en))); ro.observe(el); } catch (e) {}
      requestAnimationFrame(() => this._measure(i));
      setTimeout(() => this._measure(i), 500);
      this._applyItem(i);
    }

    async _deleteCard(i) {
      const it = this._items[i], en = this._children[i]; if (!it || !en) return;
      this._undo.push([{ remove: true, index: i, item: it }]); if (this._undo.length > 50) this._undo.shift();
      try { en.itemEl.remove(); } catch (e) {}
      this._items.splice(i, 1); this._children.splice(i, 1);
      this._sel.clear(); this._renderSelection(); this._reindexDrafts(); this._fitHeight();
      this._toast('כרטיס נמחק ✓ — ↶ לביטול');
      this._saveToConfig(true);
    }

    // After a structural change (delete/re-insert) realign the per-index
    // localStorage drafts so they keep matching the items array.
    _reindexDrafts() {
      try {
        const pre = 'shimon-board:' + location.pathname.split('?')[0] + ':' + this._boardId + ':';
        for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) localStorage.removeItem(k); }
        for (let i = 0; i < this._items.length; i++) savePos(this._boardId, i, this._items[i].pos);
      } catch (e) {}
    }
  }

  if (!customElements.get('shimon-canvas-board')) {
    customElements.define('shimon-canvas-board', ShimonCanvasBoard);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: 'shimon-canvas-board', name: 'Shimon Canvas Board', description: 'Free-canvas board: place cards anywhere, content scales, faithful on reload.' });
    window.shimonBoardReset = function () { const pre = `shimon-board:${location.pathname.split('?')[0]}:`; for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(pre)) localStorage.removeItem(k); } location.reload(); };
    window.shimonBoardUndo = function () { document.querySelectorAll('shimon-canvas-board').forEach(b => b.undo && b.undo()); };
    console.info('%c SHIMON-CANVAS-BOARD %c v1.9 ', 'background:#1e5aa6;color:#fff;padding:2px 8px;border-radius:4px', 'background:#26314d;color:#fff;padding:2px 8px;border-radius:4px');
  }
})();
