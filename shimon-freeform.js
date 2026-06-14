/**
 * shimon-freeform.js  v6.6 — "Studio"
 * ────────────────────────────────────────────────────────────────────────────
 * Freeform drag / resize / smart-fit overlay for ANY Home Assistant dashboard.
 * Designed to be published as a standalone open-source Lovelace resource.
 *
 * What makes v4.0 different from every prior attempt (and why it finally has
 * NO blocked cards):
 *
 *  1. LEAF-ONLY ATTACH (shadow-DOM-piercing).
 *     Earlier versions attached handles to BOTH a container card and the cards
 *     nested inside it (because `Element.contains()` does not cross shadow
 *     roots, 38/63 cards were double-attached). v4.0 walks the real composed
 *     tree and keeps only the innermost "leaf" card, so a grid of icons becomes
 *     N independently movable icons — nothing is trapped.
 *
 *  2. TRANSFORM-BASED MOVEMENT (translate3d), not position:absolute.
 *     `position:absolute` re-parents a card to its nearest positioned ancestor;
 *     for nested cards that ancestor itself moves, which is exactly why some
 *     cards "couldn't" be dragged. `transform` offsets a card visually without
 *     touching layout or the offsetParent chain, so it works identically no
 *     matter how deeply a card is nested.
 *
 *  3. SMART FIT (the "intelligent" scaling).
 *     When you resize a card we DO NOT freeze its content and scale it
 *     uniformly (which would scale the empty space too). Instead the card box
 *     reflows naturally — so internal whitespace collapses first (flex
 *     space-between gaps shrink, grids retrack) — and only THEN, if the content
 *     would actually overflow, we scale the text down just enough to fit. Grow
 *     the card and the reverse happens: whitespace expands first, then text
 *     grows to fill leftover room. Driven by a per-card ResizeObserver.
 *
 * Persistence: localStorage (instant, offline) + HA `frontend.user_data`
 * (server-side, synced across browsers / iPads). Per-dashboard-path.
 *
 * Scope: only auto-activates on `/dashboard-shimon*` paths. Change
 * SCOPE_PREFIX below to deploy elsewhere, or set it to '' for all dashboards.
 */

(function () {
  if (window.__SHIMON_FF_INIT__) return;
  window.__SHIMON_FF_INIT__ = true;

  // ── config ────────────────────────────────────────────────────────────────
  // Public users override these WITHOUT editing source by setting, before this
  // resource loads:  window.ShimonFreeformConfig = { scope:'', grid:8 }
  //   scope: dashboard path prefix it activates on ('' = every dashboard)
  //   grid:  snap-to-grid size in px
  // The fallback below keeps it scoped to a single dashboard path, so it can
  // never touch any other dashboard on the system.
  const CFG           = (typeof window !== 'undefined' && window.ShimonFreeformConfig) || {};
  const VERSION       = 'v7.0.2';
  const SCOPE_PREFIX  = (typeof CFG.scope === 'string') ? CFG.scope : '/dashboard-shimon';
  const GRID          = (CFG.grid > 0) ? CFG.grid : 8;   // snap-to-grid pixels
  const MIN_W         = 56;                       // legible floor — never shrink below this
  const MIN_H         = 40;
  const SNAP_DIST     = 6;                        // magnetic alignment range (px)
  const FIT_MIN       = 0.25;                     // smallest content scale (shrink-to-fit floor)
  const GROW_MAX      = 8;                        // largest content scale when enlarging a card
  const STORE_FMT     = 3;                        // storage schema version (3 = per-breakpoint + style)

  // ── i18n ────────────────────────────────────────────────────────────────────
  function uiLang() {
    let l = '';
    try { const ha = document.querySelector('home-assistant'); l = (ha && ha.hass && ha.hass.language) || ''; } catch {}
    l = (l || document.documentElement.lang || (navigator.language || 'en')).toLowerCase();
    if (l.startsWith('he') || l.startsWith('iw')) return 'he';
    if (l.startsWith('fr')) return 'fr';
    return 'en';
  }
  const RTL_LANGS = ['he', 'iw', 'ar', 'fa', 'ur'];
  function uiDir() {
    if (document.dir) return document.dir;
    const l = (document.querySelector('home-assistant')?.hass?.language || document.documentElement.lang || '').toLowerCase();
    return RTL_LANGS.some(x => l.startsWith(x)) ? 'rtl' : 'ltr';
  }
  const I18N = {
    en: { drag:'Drag', resize:'Resize', toggle:'Lock / arrange · triple-click = rescue stuck cards', undo:'Undo (Ctrl+Z)', redo:'Redo (Ctrl+Shift+Z)',
      sceneMain:'Main', opacity:'Opacity', blur:'Blur', corners:'Corners', shadow:'Shadow', rotate:'Rotate',
      presetGlass:'Glass', presetDark:'Dark', presetNeon:'Neon', presetFrame:'Frame', presetGhost:'Transparent', presetClean:'Clean',
      bg:'Background', customColor:'Custom color', styles:'Styles', editReal:'Edit', editRealTitle:'Open the real Home Assistant editor (double-click a card)',
      lockCard:'Lock / unlock card', resetCard:'Reset card style',
      alLeft:'Align left', alHC:'Center horizontally', alRight:'Align right', alTop:'Align top', alVC:'Center vertically', alBottom:'Align bottom',
      alHDist:'Distribute horizontally', alVDist:'Distribute vertically', toFront:'Bring to front', toBack:'Send to back',
      clearSel:'Clear selection', done:'Done', scenes:'Scenes', delScene:'Delete current scene', newScene:'New scene (copy of current)',
      coach:'👆 Tap here to rearrange your cards', toastReset:'Card reset',
      toastNothing:'Nothing to rescue', toastRescued:n=>`Rescued ${n} card${n===1?'':'s'}`,
      copyStyle:'Copy style', pasteStyle:'Paste style', toastCopied:'Style copied', toastPasted:'Style pasted',
      nCards:n=>`${n} cards selected`, sceneDefault:n=>'Scene '+n, deleteSceneQ:name=>`Delete scene "${name}"?`,
      scenePrompt:'Name the new scene (e.g. Night, Guests):' },
    fr: { drag:'Déplacer', resize:'Redimensionner', toggle:'Verrouiller / ranger · triple-clic = récupérer les cartes coincées', undo:'Annuler (Ctrl+Z)', redo:'Refaire (Ctrl+Maj+Z)',
      sceneMain:'Principal', opacity:'Opacité', blur:'Flou', corners:'Coins', shadow:'Ombre', rotate:'Rotation',
      presetGlass:'Verre', presetDark:'Sombre', presetNeon:'Néon', presetFrame:'Cadre', presetGhost:'Transparent', presetClean:'Net',
      bg:'Fond', customColor:'Couleur personnalisée', styles:'Styles', editReal:'Éditer', editRealTitle:'Ouvrir le vrai éditeur Home Assistant (double-clic sur une carte)',
      lockCard:'Verrouiller / déverrouiller la carte', resetCard:'Réinitialiser le style de la carte',
      alLeft:'Aligner à gauche', alHC:'Centrer horizontalement', alRight:'Aligner à droite', alTop:'Aligner en haut', alVC:'Centrer verticalement', alBottom:'Aligner en bas',
      alHDist:'Répartir horizontalement', alVDist:'Répartir verticalement', toFront:'Mettre au premier plan', toBack:'Mettre à l’arrière',
      clearSel:'Annuler la sélection', done:'Terminé', scenes:'Ambiances', delScene:'Supprimer l’ambiance actuelle', newScene:'Nouvelle ambiance (copie de l’actuelle)',
      coach:'👆 Touchez ici pour ranger vos cartes', toastReset:'Carte réinitialisée',
      toastNothing:'Rien à récupérer', toastRescued:n=>`${n} carte${n===1?'':'s'} récupérée${n===1?'':'s'}`,
      copyStyle:'Copier le style', pasteStyle:'Coller le style', toastCopied:'Style copié', toastPasted:'Style collé',
      nCards:n=>`${n} cartes sélectionnées`, sceneDefault:n=>'Ambiance '+n, deleteSceneQ:name=>`Supprimer l’ambiance « ${name} » ?`,
      scenePrompt:'Nom de la nouvelle ambiance (ex. : Nuit, Invités) :' },
    he: { drag:'גרור', resize:'שנה גודל', toggle:'נעל/סדר · 3 קליקים = שחזר כרטיסים תקועים', undo:'בטל (Ctrl+Z)', redo:'בצע שוב (Ctrl+Shift+Z)',
      sceneMain:'ראשי', opacity:'שקיפות', blur:'טשטוש', corners:'פינות', shadow:'צל', rotate:'סיבוב',
      presetGlass:'זכוכית', presetDark:'כהה', presetNeon:'ניאון', presetFrame:'מסגרת', presetGhost:'שקוף', presetClean:'נקי',
      bg:'רקע', customColor:'צבע מותאם אישית', styles:'סגנונות', editReal:'ערוך אמיתי', editRealTitle:'פתח את העורך האמיתי של Home Assistant (לחיצה כפולה על כרטיס)',
      lockCard:'נעל / שחרר כרטיס', resetCard:'אפס עיצוב כרטיס',
      alLeft:'יישור שמאל', alHC:'מרכוז אופקי', alRight:'יישור ימין', alTop:'יישור עליון', alVC:'מרכוז אנכי', alBottom:'יישור תחתון',
      alHDist:'פיזור אופקי', alVDist:'פיזור אנכי', toFront:'הבא לחזית', toBack:'שלח לאחור',
      clearSel:'בטל בחירה', done:'סיים', scenes:'סצנות', delScene:'מחק סצנה נוכחית', newScene:'סצנה חדשה (העתק של הנוכחית)',
      coach:'👆 לחצו כאן כדי לסדר את הכרטיסים', toastReset:'הכרטיס אופס',
      toastNothing:'אין מה לשחזר', toastRescued:n=>`${n} כרטיסים שוחזרו`,
      copyStyle:'העתק עיצוב', pasteStyle:'הדבק עיצוב', toastCopied:'העיצוב הועתק', toastPasted:'העיצוב הודבק',
      nCards:n=>`${n} כרטיסים נבחרו`, sceneDefault:n=>'סצנה '+n, deleteSceneQ:name=>`למחוק את הסצנה "${name}"?`,
      scenePrompt:'שם הסצנה החדשה (למשל: לילה, אורחים):' },
  };
  function t(k, ...a) { const v = (I18N[uiLang()] || I18N.en)[k]; const w = v == null ? (I18N.en[k] != null ? I18N.en[k] : k) : v; return typeof w === 'function' ? w(...a) : w; }

  // ── responsive breakpoints ──────────────────────────────────────────────────
  // A separate layout is stored for each screen class so the dashboard you
  // arrange on a desktop doesn't land scrambled on an iPad / phone.
  function currentBP() {
    const w = window.innerWidth;
    return w <= 600 ? 'phone' : w <= 1024 ? 'tablet' : 'desktop';
  }
  // When the current breakpoint has no saved layout, fall back to the nearest
  // larger one so a new device starts from a sensible arrangement, not blank.
  const BP_FALLBACK = {
    phone:   ['phone', 'tablet', 'desktop'],
    tablet:  ['tablet', 'desktop', 'phone'],
    desktop: ['desktop', 'tablet', 'phone'],
  };

  // default per-card visual style (no override)
  const DEFAULT_STYLE = { opacity: 100, blur: 0, radius: null, shadow: null, rotate: 0, bg: '' };

  const prefix = () => `shimon-fp:${location.pathname.split('?')[0]}:`;
  let   HANDLES = [];                             // [{card, grip, resize, slotId}]
  const UNDO    = [];
  const REDO    = [];

  const ZOOM_OK = (() => {
    const d = document.createElement('div');
    d.style.zoom = '0.5';
    return d.style.zoom !== '';
  })();

  function inScope() { return location.pathname.startsWith(SCOPE_PREFIX); }
  function editing() { return document.body.dataset.shimonEdit === '1'; }

  // ── server sync ─────────────────────────────────────────────────────────────
  const Sync = {
    hass: null, pending: new Map(), timer: null,
    setHass(h) { if (!this.hass && h) this.hass = h; },
    key() { return `shimon_layout:${location.pathname.split('?')[0]}`; },
    async loadAll() {
      if (!this.hass) return null;
      try {
        const r = await this.hass.callWS({ type: 'frontend/get_user_data', key: this.key() });
        return (r && r.value) || {};
      } catch { return null; }
    },
    queue(slot, pos) {
      this.pending.set(slot, pos);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 400);
    },
    async flush() {
      if (!this.hass) return;
      const all = (await this.loadAll()) || {};
      for (const [k, v] of this.pending) (v === null) ? delete all[k] : (all[k] = v);
      this.pending.clear();
      try { await this.hass.callWS({ type: 'frontend/set_user_data', key: this.key(), value: all }); }
      catch (e) { console.warn('[shimon-freeform] server save failed', e); }
    },
    flushNow() { clearTimeout(this.timer); return this.flush(); },
    async clear() {
      if (!this.hass) return;
      try { await this.hass.callWS({ type: 'frontend/set_user_data', key: this.key(), value: {} }); } catch {}
    },
  };

  // ── scenes ──────────────────────────────────────────────────────────────────
  // A "scene" is a complete alternate arrangement of the same dashboard
  // (Day / Night / Guest …). Each scene namespaces every card's record, so
  // switching a scene swaps the whole layout (positions + sizes + styles) in
  // one tap. The active scene + scene list live in a meta record.
  const META_KEY = '__shimon_meta__';
  let SCENES = ['ראשי'];
  let activeScene = 'ראשי';
  function skey(slot) { return activeScene + '::' + slot; }

  // ── input validation ────────────────────────────────────────────────────────
  // Records live in localStorage AND are synced to the server's per-user store,
  // then auto-applied on every device. So a hand-crafted / cross-device record
  // is UNTRUSTED input. We never apply raw values: numbers are clamped, the
  // style object is rebuilt from a fixed key set (no prototype pollution), and
  // backgrounds are restricted to a safe CSS allowlist — so a malicious record
  // can't paint a full-screen overlay, smuggle a remote url() tracking beacon,
  // or break out of the inline style. This is the core hardening before public.
  function clampNum(v, lo, hi, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  }
  const BG_OK = /^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\)|(?:linear|radial)-gradient\([#0-9a-z.,%\s-]+\))$/i;
  function safeBg(bg) {
    if (typeof bg !== 'string') return '';
    const s = bg.trim();
    if (!s || s.length > 160) return '';
    if (/url\(|;|<|>|expression|javascript:|@import|\\/i.test(s)) return '';
    return BG_OK.test(s) ? s : '';
  }
  function validateStyle(st) {
    if (!st || typeof st !== 'object') return null;
    const out = {
      opacity: clampNum(st.opacity, 10, 100, 100),
      blur:    clampNum(st.blur, 0, 40, 0),
      radius:  st.radius == null ? null : clampNum(st.radius, 0, 80, null),
      shadow:  st.shadow == null ? null : clampNum(st.shadow, 0, 60, null),
      rotate:  clampNum(st.rotate, -180, 180, 0),
      bg:      safeBg(st.bg),
    };
    return normalizeStyle(out);   // collapse to null if it's just the defaults
  }
  function validateEntry(e) {
    if (!e || typeof e !== 'object') return null;
    return {
      tx: clampNum(e.tx, -20000, 20000, 0),
      ty: clampNum(e.ty, -20000, 20000, 0),
      w:  e.w == null ? null : clampNum(e.w, MIN_W, 6000, null),
      h:  e.h == null ? null : clampNum(e.h, MIN_H, 6000, null),
      z:  e.z == null ? null : Math.round(clampNum(e.z, -1000, 1000, 0)),
      style:  validateStyle(e.style),
      locked: e.locked ? true : undefined,
      natW: e.natW == null ? undefined : clampNum(e.natW, 1, 6000, undefined),
      natH: e.natH == null ? undefined : clampNum(e.natH, 1, 6000, undefined),
    };
  }
  function validateScenes(arr) {
    let s = Array.isArray(arr) ? arr : [];
    s = s.filter(x => typeof x === 'string')
         .map(x => [...String(x)].filter(c => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>').join('').slice(0, 40))
         .filter(Boolean).slice(0, 40);
    return s.length ? s : ['ראשי'];
  }

  function loadMeta() {
    try {
      const r = localStorage.getItem('shimon-fp-meta:' + location.pathname.split('?')[0]);
      if (r) {
        const m = JSON.parse(r);
        if (m && m.scenes) { SCENES = validateScenes(m.scenes); activeScene = (typeof m.active === 'string' && SCENES.includes(m.active)) ? m.active : SCENES[0]; }
      }
    } catch {}
  }
  function saveMeta() {
    const m = { scenes: SCENES, active: activeScene, f: STORE_FMT };
    try { localStorage.setItem('shimon-fp-meta:' + location.pathname.split('?')[0], JSON.stringify(m)); } catch {}
    Sync.queue(META_KEY, m);
  }
  loadMeta();

  // ── local storage (per-scene, per-breakpoint records) ───────────────────────
  // Record shape: { bp: { desktop:{tx,ty,w,h,style,z}, tablet:{…}, phone:{…} }, f:3 }
  function loadRecord(slot) {
    try {
      const r = localStorage.getItem(prefix() + skey(slot));
      if (!r) return null;
      const p = JSON.parse(r);
      return (p && p.f === STORE_FMT && p.bp) ? p : null;   // ignore old-format
    } catch { return null; }
  }
  // current-breakpoint entry, with fallback to the nearest larger breakpoint
  function load(slot) {
    const rec = loadRecord(slot);
    if (!rec) return null;
    // Validate at the read boundary: every entry that reaches applyStored/undo
    // is clamped + key-whitelisted + bg-sanitised, whether it came from
    // localStorage or the synced server blob.
    for (const bp of BP_FALLBACK[currentBP()]) if (rec.bp[bp]) return validateEntry(rec.bp[bp]);
    return null;
  }
  function storeLocal(slot, entry) {
    try {
      let rec = loadRecord(slot) || { bp: {}, f: STORE_FMT };
      if (entry === null) {
        delete rec.bp[currentBP()];
        if (!Object.keys(rec.bp).length) { localStorage.removeItem(prefix() + skey(slot)); return; }
      } else {
        rec.bp[currentBP()] = entry;
      }
      localStorage.setItem(prefix() + skey(slot), JSON.stringify(rec));
    } catch {}
  }
  function clearStore() {                       // wipe ALL scenes
    const p = prefix();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) localStorage.removeItem(k);
    }
    try { localStorage.removeItem('shimon-fp-meta:' + location.pathname.split('?')[0]); } catch {}
  }
  function clearScene(scene) {                  // wipe one scene's card records
    const p = prefix() + scene + '::';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) localStorage.removeItem(k);
    }
  }
  // Persist the current breakpoint's entry locally + push the WHOLE record to
  // the server (scene-namespaced) so everything stays in sync across devices.
  function save(slot, entry) {
    storeLocal(slot, entry);
    Sync.queue(skey(slot), loadRecord(slot));
  }
  // alias kept for older call-sites that wrote a raw entry
  function store(slot, entry) { storeLocal(slot, entry); }

  function snap(n) { return Math.round(n / GRID) * GRID; }

  // ── stable slot id (content/path hash, survives re-render & re-order) ────────
  function slotId(card) {
    const parts = [];
    let el = card, depth = 0;
    while (el && depth < 26) {
      let parent = el.parentNode;
      if (parent instanceof ShadowRoot) parent = parent.host;
      if (!parent) break;
      const kids = parent.children ? [...parent.children] : [];
      const i = kids.indexOf(el);
      const tag = (el.tagName || 'x').toLowerCase();
      const ent = (el.config && (el.config.entity || (el.config.card && el.config.card.entity))) || '';
      // Prefer a stable identity (entity id) over positional index so a card
      // keeps its slot when HA reflows/reorders siblings (e.g. a badge appears
      // when an entity goes unavailable). Only anonymous containers fall back
      // to index.
      parts.unshift(ent ? `${tag}:${ent}` : `${tag}:${i}`);
      el = parent; depth++;
    }
    let h = 5381;
    const s = parts.join('>');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return 'k' + (h >>> 0).toString(36);
  }

  // ── target discovery + LEAF filter (shadow-piercing) ─────────────────────────
  const SELECTORS = [
    'hui-card', 'hui-badge', 'hui-state-label-badge', 'hui-image-badge',
    'hui-entity-badge', 'state-badge', 'hui-entity-filter-badge',
    'mushroom-chips-card', 'mushroom-template-card', 'mushroom-entity-card',
    'mushroom-title-card', 'button-card', 'bubble-card',
  ].join(',');

  function findAll(root = document, depth = 0, out = []) {
    if (depth > 32 || !root) return out;
    const s = root.shadowRoot || root;
    if (!s.querySelectorAll) return out;
    for (const c of s.querySelectorAll(SELECTORS)) if (!out.includes(c)) out.push(c);
    for (const el of s.querySelectorAll('*')) if (el.shadowRoot) findAll(el.shadowRoot, depth + 1, out);
    return out;
  }

  // shadow-piercing "is a inside b?"
  function inside(a, b) {
    let n = a.parentNode;
    while (n) {
      if (n === b) return true;
      n = (n instanceof ShadowRoot) ? n.host : n.parentNode;
    }
    return false;
  }

  // A swipe/carousel card is a single movable UNIT — its slides scroll inside it
  // and must never get their own handles. So we ignore any matched card that
  // lives inside a swiper, which also lets the card WRAPPING the swiper qualify
  // as a leaf (e.g. the weather forecast that sits inside a css-swipe-card).
  function insideSwipe(el) {
    let n = el.parentNode;
    while (n) {
      if (n.tagName && /(^|-)swipe-card$/i.test(n.tagName)) return true;
      n = (n instanceof ShadowRoot) ? n.host : n.parentNode;
    }
    return false;
  }
  // keep only leaves: a card that contains NO other matched card
  function leaves(list) {
    const usable = list.filter(el => !insideSwipe(el));
    return usable.filter(el => !usable.some(o => o !== el && inside(o, el)));
  }

  // ── ancestor un-clipping (with restore) ─────────────────────────────────────
  const FREED = new Map();   // el -> snapshot
  function unclip(card) {
    let el = card.parentNode, depth = 0;
    while (el && el !== document.body && depth < 18) {
      if (el instanceof ShadowRoot) { el = el.host; continue; }
      if (el.style && !FREED.has(el)) {
        // One exotic/read-only ancestor must never throw and abort the whole
        // attach (which would leave the rest of the dashboard handle-less).
        try {
          const cs = getComputedStyle(el);
          FREED.set(el, {
            overflow: el.style.overflow, overflowX: el.style.overflowX, overflowY: el.style.overflowY,
            contain: el.style.contain, clipPath: el.style.clipPath,
          });
          if (cs.overflow !== 'visible')  el.style.overflow  = 'visible';
          if (cs.overflowX !== 'visible') el.style.overflowX = 'visible';
          if (cs.overflowY !== 'visible') el.style.overflowY = 'visible';
          if (cs.contain !== 'none' && cs.contain !== 'normal') el.style.contain = 'none';
          if (cs.clipPath !== 'none') el.style.clipPath = 'none';
        } catch {}
      }
      el = el.parentNode; depth++;
    }
  }

  // Restore everything unclip() forced — called when leaving the dashboard so we
  // never leave HA's containers permanently un-clipped after navigating away.
  function reclip() {
    for (const [el, s] of FREED) {
      try {
        el.style.overflow = s.overflow; el.style.overflowX = s.overflowX; el.style.overflowY = s.overflowY;
        el.style.contain = s.contain; el.style.clipPath = s.clipPath;
      } catch {}
    }
    FREED.clear();
  }

  // Extra scroll room so a card dragged below the fold stays reachable. Applied
  // ONLY while editing, and restored on lock — so a locked/viewing dashboard is
  // never left stretched with a big empty gap (the old blanket 180vh bug).
  const DRAG_ROOM = new Map();   // view el -> original inline min-height
  function setDragRoom(on) {
    if (on) {
      const views = new Set();
      for (const h of HANDLES) {
        let el = h.card.parentNode;
        for (let i = 0; i < 24 && el; i++) {
          const t = el.tagName && el.tagName.toLowerCase();
          if (t === 'hui-view' || t === 'hui-sections-view' || t === 'hui-masonry-view' || t === 'hui-panel-view') { views.add(el); break; }
          el = (el instanceof ShadowRoot) ? el.host : el.parentNode;
        }
      }
      for (const v of views) {
        try { if (!DRAG_ROOM.has(v)) DRAG_ROOM.set(v, v.style.minHeight || ''); v.style.minHeight = '170vh'; } catch {}
      }
    } else {
      for (const [v, mh] of DRAG_ROOM) { try { v.style.minHeight = mh; } catch {} }
      DRAG_ROOM.clear();
    }
  }

  // ── SMART FIT ────────────────────────────────────────────────────────────────
  // The element whose content we scale. Many cards (custom:button-card,
  // mushroom-*, etc.) render their real content as an <ha-card> inside their
  // OWN shadow root, which `querySelector` cannot reach — so we pierce one
  // shadow level. Without this, button-cards (e.g. the clock) report
  // scrollWidth 0 and smart-fit silently does nothing → digits clip on shrink.
  function innerOf(card) {
    let el = card.querySelector('ha-card');
    if (el) return el;
    if (card.shadowRoot) {
      el = card.shadowRoot.querySelector('ha-card');
      if (el) return el;
      // deepest single content wrapper (button-card-main div, etc.)
      el = card.shadowRoot.querySelector('.button-card-main, [class*="card-content"], div');
      if (el) return el;
    }
    return card.firstElementChild;
  }

  // Where to physically place the drag handles. Some custom cards
  // (custom:button-card, hui-badge, mushroom-*) render their content in a
  // shadow root that has NO <slot>, so a light-DOM child we append is never
  // projected and stays 0×0 (invisible). For those we append the handles into
  // the shadow content box instead. Cards WITH a slot (hui-card) take the
  // light-DOM host as usual.
  function handleHost(card) {
    const sr = card.shadowRoot;
    if (sr && !sr.querySelector('slot')) {
      // The host must be a positioned containing block so the absolutely-
      // positioned handles (appended into its shadow root) resolve against the
      // host's own box — and stay outside the inner content that smart-fit
      // zooms, so the handles never scale with the card's text.
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      const box = sr.querySelector('ha-card') ||
                  sr.querySelector('.button-card-main, [class*="card-content"]');
      if (box) box.style.overflow = 'visible';
      return sr;
    }
    return card;
  }

  // Detect content that manages its own overflow (marquees, scroll regions,
  // CSS animations). Such cards must NOT be uniformly scaled — their
  // scrollHeight is intentionally larger than the box. We let natural reflow
  // collapse their whitespace instead. Cached per card.
  function selfScrolls(card) {
    if (card.__shimonScroll !== undefined) return card.__shimonScroll;
    let result = false;
    const inner = innerOf(card);
    if (inner) {
      const nodes = [inner, ...inner.querySelectorAll('*')];
      for (let i = 0; i < nodes.length && i < 400; i++) {
        const el = nodes[i];
        if (el.clientHeight < 8 && el.clientWidth < 8) continue;
        // "Much larger content than its box" = a real scroll/marquee region.
        const big = el.scrollHeight > el.clientHeight * 1.6 || el.scrollWidth > el.clientWidth * 1.6;
        if (!big) continue;                              // cheap reject first
        const cs = getComputedStyle(el);
        const clipped = ['hidden', 'scroll', 'auto'].includes(cs.overflowY) ||
                        ['hidden', 'scroll', 'auto'].includes(cs.overflowX);
        const animated = cs.animationName && cs.animationName !== 'none';
        // Flag ONLY genuine scroll/marquee: oversized content that is either
        // clipped by an overflow container OR moved by an animation (a real
        // marquee). A blinking colon or decorative pulse — whose element is
        // NOT oversized — no longer disables smart-fit, so the clock's digits
        // scale to fit instead of clipping.
        if (clipped || animated) { result = true; break; }
      }
    }
    card.__shimonScroll = result;
    return result;
  }

  function applyScale(inner, s) {
    if (Math.abs(s - 1) < 0.02) {
      inner.style.zoom = ''; inner.style.transform = ''; inner.style.transformOrigin = '';
      return;
    }
    if (ZOOM_OK) {
      inner.style.zoom = s.toFixed(3);
      inner.style.transform = ''; inner.style.transformOrigin = '';
    } else {
      inner.style.transformOrigin = uiDir() === 'rtl' ? 'top right' : 'top left';
      inner.style.transform = `scale(${s.toFixed(3)})`;
      inner.style.zoom = '';
    }
  }

  // The core "intelligent" routine. Box reflows naturally (whitespace collapses
  // first); we only scale text when it would overflow, or grow it to fill clear
  // empty space. Never clips, never wastes space.
  function fit(card) {
    const inner = innerOf(card);
    if (!inner) return;
    if (card.__shimonFitting) return;
    card.__shimonFitting = true;
    try {
      // 1. reset scale so content reflows at its natural size inside the new box
      inner.style.zoom = ''; inner.style.transform = ''; inner.style.transformOrigin = '';
      inner.style.width = ''; inner.style.height = '';

      const boxW = card.clientWidth, boxH = card.clientHeight;
      if (boxW < 4 || boxH < 4) return;
      const natW = card.__shimonNatW || boxW, natH = card.__shimonNatH || boxH;
      const grow = Math.min(boxW / natW, boxH / natH);

      // 2. GROW: when the card has been enlarged past its natural size, scale the
      //    CONTENT up with the frame — enlarging a card enlarges what's inside it,
      //    not just the frame. We pin the inner box to the natural size so the
      //    zoom fills the enlarged frame exactly; the factor tracks the drag, so
      //    it never balloons. This runs for EVERY card — including slot-less top
      //    badges/buttons (and before the self-scroll guard) — so resizing is
      //    consistent everywhere.
      if (card.__shimonSized && grow > 1.04) {
        inner.style.width = natW + 'px'; inner.style.height = natH + 'px';
        applyScale(inner, Math.min(grow, GROW_MAX));
        return;
      }

      // Self-scrolling content (marquees etc.) manages its own overflow — never
      // shrink-scale it (that would clip the scroll/animation region).
      if (selfScrolls(card)) return;

      // 3. SHRINK: after the natural reflow (which already collapsed internal
      //    whitespace), does the content still overflow the smaller box?  If so,
      //    scale down by exactly the overflow ratio so nothing clips (the clock's
      //    digits follow the box, not "2 of 6"). Otherwise leave it at 1×.
      const ov = Math.max(inner.scrollWidth / boxW, inner.scrollHeight / boxH);
      if (ov > 1.01) applyScale(inner, Math.max(FIT_MIN, Math.min(1, 1 / ov)));
      else applyScale(inner, 1);
    } finally {
      card.__shimonFitting = false;
    }
  }

  // After an ENLARGE, the box can be bigger than the (uniformly scaled) content —
  // a wide clock dragged into a tall box leaves empty space, which reads as "the
  // frame grew but the clock didn't". Snap the card's box to hug its scaled
  // content so enlarging grows the CONTENT, not the empty frame around it. This
  // only ever SHRINKS the box (removes margin), never grows it — so shrink-to-fit
  // (where the content already fills the box) is untouched.
  function hugBox(card) {
    if (!card.__shimonSized) return;
    const inner = innerOf(card);
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    if (ir.width < 8 || ir.height < 8) return;
    const cr = card.getBoundingClientRect();
    if (cr.height - ir.height > 6) card.style.height = Math.ceil(ir.height) + 'px';
    if (cr.width  - ir.width  > 6) card.style.width  = Math.ceil(ir.width)  + 'px';
  }

  // ── grid + snap visuals ─────────────────────────────────────────────────────
  let gridEl = null;
  function showGrid() {
    if (gridEl) return;
    gridEl = document.createElement('div');
    Object.assign(gridEl.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '40', opacity: '0',
      // Indigo accent dots stay visible on BOTH light and dark dashboards — a
      // white dot at 10% was invisible on the default light HA theme.
      backgroundImage: 'radial-gradient(circle, rgba(79,108,240,0.30) 1px, transparent 1.6px)',
      backgroundSize: `${GRID * 2}px ${GRID * 2}px`, transition: 'opacity .25s ease',
    });
    document.body.appendChild(gridEl);
    requestAnimationFrame(() => gridEl && (gridEl.style.opacity = '1'));
  }
  function hideGrid() {
    if (!gridEl) return;
    const g = gridEl; gridEl = null;
    g.style.opacity = '0'; setTimeout(() => g.remove(), 250);
  }
  // tiny transient feedback toast (so silent actions like reset/rescue confirm)
  function toast(msg) {
    let el = document.getElementById('shimon-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'shimon-toast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '92px', left: '50%', transform: 'translateX(-50%) translateY(10px)',
        zIndex: '2147483640', padding: '10px 18px', borderRadius: '14px',
        background: 'linear-gradient(135deg,rgba(28,32,54,.97),rgba(18,20,38,.97))', color: '#eaf0ff',
        font: '700 13px Heebo,Assistant,system-ui,sans-serif', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
        border: '1px solid rgba(255,255,255,.14)', opacity: '0', pointerEvents: 'none',
        transition: 'opacity .2s ease, transform .2s ease', maxWidth: '80vw', textAlign: 'center', direction: uiDir(),
      });
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.direction = uiDir();
    clearTimeout(el.__t);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    el.__t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(10px)'; }, 1900);
  }
  const lines = [];
  function clearLines() { lines.forEach(l => l.remove()); lines.length = 0; }
  function line(v, x, y, len) {
    const l = document.createElement('div');
    Object.assign(l.style, {
      position: 'fixed', background: '#ffd166', boxShadow: '0 0 10px rgba(255,209,102,.85)',
      zIndex: '60', pointerEvents: 'none', opacity: '0', transition: 'opacity .1s ease',
      left: v ? `${x - 1}px` : `${x}px`, top: v ? `${y}px` : `${y - 1}px`,
      width: v ? '2px' : `${len}px`, height: v ? `${len}px` : '2px',
    });
    document.body.appendChild(l);
    requestAnimationFrame(() => l.style.opacity = '1');
    lines.push(l);
  }

  function purge() { HANDLES = HANDLES.filter(h => h.card.isConnected); }

  // snap a prospective viewport rect to nearby cards; returns {dx, dy}
  function computeSnap(card, vx, vy, w, h) {
    purge();
    const cx = vx + w / 2, cy = vy + h / 2, rx = vx + w, by = vy + h;
    const near = [];
    for (const hd of HANDLES) {
      if (hd.card === card) continue;
      const r = hd.card.getBoundingClientRect();
      if (r.right < vx - 280 || r.left > rx + 280 || r.bottom < vy - 280 || r.top > by + 280) continue;
      near.push(r);
    }
    clearLines();
    let dx = 0, dy = 0, sdx = SNAP_DIST + 1, sdy = SNAP_DIST + 1, vX = null, vY = null;
    let t = Infinity, b = -Infinity, l = Infinity, rr = -Infinity;
    for (const o of near) {
      const oCX = (o.left + o.right) / 2, oCY = (o.top + o.bottom) / 2;
      for (const c of [[vx, o.left], [rx, o.right], [cx, oCX], [rx, o.left], [vx, o.right]]) {
        const d = Math.abs(c[0] - c[1]); if (d < sdx) { sdx = d; dx = c[1] - c[0]; vX = c[1]; }
      }
      for (const c of [[vy, o.top], [by, o.bottom], [cy, oCY], [by, o.top], [vy, o.bottom]]) {
        const d = Math.abs(c[0] - c[1]); if (d < sdy) { sdy = d; dy = c[1] - c[0]; vY = c[1]; }
      }
      t = Math.min(t, o.top, vy); b = Math.max(b, o.bottom, by);
      l = Math.min(l, o.left, vx); rr = Math.max(rr, o.right, rx);
    }
    if (sdx > SNAP_DIST) { dx = 0; vX = null; }
    if (sdy > SNAP_DIST) { dy = 0; vY = null; }
    if (vX !== null) line(true, vX, t, b - t);
    if (vY !== null) line(false, l, vY, rr - l);
    return { dx, dy };
  }

  // ── handle styles ───────────────────────────────────────────────────────────
  // Handles use a saturated INDIGO fill + a white ring + a dark shadow so they
  // stay clearly visible on ANY card background — white/light cards (clock,
  // weather, badges) and dark cards (cameras) alike. A plain white handle was
  // invisible on light-themed dashboards.
  // Touch devices get noticeably larger handles — a 9px bar is impossible to hit
  // with a finger; on coarse pointers we go to finger-sized targets (~Apple 44px
  // guidance, scaled to the card).
  function coarse() { try { return matchMedia('(pointer:coarse)').matches; } catch { return false; } }
  function gripStyle(w) {
    const fat = coarse();
    return {
      position: 'absolute', top: fat ? '0px' : '3px', left: '50%', transform: 'translateX(-50%)',
      width: Math.min(fat ? 72 : 44, Math.max(fat ? 40 : 18, w * (fat ? 0.4 : 0.3))) + 'px',
      height: fat ? '22px' : '9px',
      background: 'linear-gradient(180deg,#8aa4ff,#4f6cf0 55%,#3a52d8)',
      borderRadius: fat ? '0 0 9px 9px' : '5px', cursor: 'grab', zIndex: '2147483000',
      boxShadow: '0 0 0 1.5px rgba(255,255,255,.95), 0 2px 7px rgba(0,0,0,.55)',
      transition: 'transform .15s cubic-bezier(.4,1.4,.6,1)', display: 'block', pointerEvents: 'auto',
      userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
    };
  }
  function resizeStyle(w) {
    const fat = coarse();
    const s = fat ? Math.min(40, Math.max(30, w * 0.24)) : Math.min(22, Math.max(14, w * 0.16));
    return {
      position: 'absolute', right: '2px', bottom: '2px', width: s + 'px', height: s + 'px',
      cursor: 'nwse-resize', zIndex: '2147483000', display: 'block', pointerEvents: 'auto',
      borderRadius: '0 0 7px 0',
      background: 'linear-gradient(135deg, transparent 42%, #4f6cf0 42%, #3a52d8 100%)',
      boxShadow: '0 0 0 1.5px rgba(255,255,255,.9), 0 2px 6px rgba(0,0,0,.5)',
      userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
    };
  }
  const OFF = { display: 'none' };
  function css(el, o) { for (const k in o) el.style[k] = o[k]; }

  function showHandles(on) {
    purge();
    for (const h of HANDLES) {
      const locked = h.card.__shimonLocked;
      if (on && !locked) {
        const w = h.card.offsetWidth || 200;
        css(h.grip, gripStyle(w)); css(h.resize, resizeStyle(w));
        h.card.style.outline = '1px solid rgba(255,255,255,.22)';
        h.card.style.outlineOffset = '-1px';
      } else {
        h.grip.style.display = 'none'; h.resize.style.display = 'none';
        // locked cards stay put in edit mode, marked with a dashed amber outline
        h.card.style.outline = (on && locked) ? '1.5px dashed rgba(255,180,80,.65)' : '';
        h.card.style.outlineOffset = (on && locked) ? '-1px' : '';
      }
    }
  }

  // ── transform helpers (translate + optional rotation) ───────────────────────
  function getT(card) { return card.__shimonT || { tx: 0, ty: 0 }; }
  function applyTransform(card) {
    const t = card.__shimonT || { tx: 0, ty: 0 };
    const rot = (card.__shimonStyle && card.__shimonStyle.rotate) || 0;
    card.style.transform = `translate3d(${t.tx}px,${t.ty}px,0)` + (rot ? ` rotate(${rot}deg)` : '');
  }
  function setT(card, tx, ty) { card.__shimonT = { tx, ty }; applyTransform(card); }

  // ── per-card visual style (no-YAML design overrides) ────────────────────────
  function applyCardStyle(card, style) {
    // CRITICAL: every visual override goes on the HOST element, not the inner
    // ha-card. HA cards are transparent glass — the real ha-card has no
    // background/radius of its own (the theme paints via CSS variables), so
    // writing inner.style.background/borderRadius is invisible. The host owns
    // the real box, so styling it is what the eye actually sees. We ALSO set
    // the native --ha-card-* variables so themed (non-glass) cards recolour too.
    card.__shimonStyle = style ? { ...style } : null;
    const s = style || {};

    // opacity → host
    card.style.opacity = (s.opacity != null && s.opacity !== 100) ? (s.opacity / 100) : '';

    // background → host paint + HA card variable (covers glass AND themed cards)
    const bg = s.bg || '';
    card.style.background = bg;
    if (bg) { card.style.setProperty('--ha-card-background', bg); card.style.setProperty('--card-background-color', bg); }
    else    { card.style.removeProperty('--ha-card-background'); card.style.removeProperty('--card-background-color'); }

    // rounded corners → host + HA variable
    if (s.radius != null) { card.style.borderRadius = s.radius + 'px'; card.style.setProperty('--ha-card-border-radius', s.radius + 'px'); }
    else { card.style.borderRadius = ''; card.style.removeProperty('--ha-card-border-radius'); }

    // drop shadow → host + HA variable
    if (s.shadow != null && s.shadow > 0) {
      const sh = `0 ${s.shadow}px ${Math.round(s.shadow * 2.4)}px rgba(0,0,0,${Math.min(0.6, 0.12 + s.shadow / 45).toFixed(2)})`;
      card.style.boxShadow = sh; card.style.setProperty('--ha-card-box-shadow', sh);
    } else { card.style.boxShadow = ''; card.style.removeProperty('--ha-card-box-shadow'); }

    // frosted glass → host backdrop blur (blurs whatever shows through a translucent bg)
    const blur = s.blur ? `blur(${s.blur}px) saturate(160%)` : '';
    card.style.backdropFilter = blur; card.style.webkitBackdropFilter = blur;

    // legacy cleanup: wipe any inner-card styles older builds may have written
    const inner = innerOf(card);
    if (inner) {
      inner.style.backdropFilter = ''; inner.style.webkitBackdropFilter = '';
      inner.style.borderRadius = ''; inner.style.boxShadow = ''; inner.style.background = '';
    }
    applyTransform(card);   // rotation
  }

  // The full saved entry for a card at the current state.
  function currentEntry(card) {
    const t = getT(card);
    return {
      tx: t.tx, ty: t.ty,
      w: card.__shimonSized ? card.offsetWidth : null,
      h: card.__shimonSized ? card.offsetHeight : null,
      style: card.__shimonStyle || null,
      z: (card.__shimonZ != null) ? card.__shimonZ : null,
      locked: card.__shimonLocked ? true : undefined,
      natW: card.__shimonNatW || undefined,
      natH: card.__shimonNatH || undefined,
    };
  }

  function applyStored(card, e) {
    if (e.w != null && e.h != null) {
      sizeMode(card);
      card.style.width = e.w + 'px';
      card.style.height = e.h + 'px';
    }
    if (e.z != null) { card.__shimonZ = e.z; card.style.zIndex = e.z; if (e.z > zTop) zTop = e.z; }
    card.__shimonLocked = !!e.locked;
    if (e.natW) { card.__shimonNatW = e.natW; card.__shimonNatH = e.natH; }
    card.__shimonT = { tx: e.tx || 0, ty: e.ty || 0 };
    applyCardStyle(card, e.style || null);   // also applies rotation via applyTransform
    if (e.w != null) fit(card);
  }

  // Clear every inline layout/style we apply, returning a card to its native look.
  function resetCardLayout(card) {
    ['width', 'height', 'transform', 'justifySelf', 'alignSelf', 'flex',
     'maxWidth', 'maxHeight', 'opacity', 'zIndex',
     'background', 'borderRadius', 'boxShadow', 'backdropFilter', 'webkitBackdropFilter'].forEach(p => card.style[p] = '');
    ['--ha-card-background', '--card-background-color', '--ha-card-border-radius', '--ha-card-box-shadow']
      .forEach(p => card.style.removeProperty(p));
    card.__shimonT = { tx: 0, ty: 0 };
    card.__shimonSized = false;
    card.__shimonZ = null;
    card.__shimonLocked = false;
    card.__shimonNatW = null; card.__shimonNatH = null;
    applyCardStyle(card, null);
  }

  function sizeMode(card) {
    // let an explicit size win inside grid/flex without leaving the flow
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.style.justifySelf = 'start'; card.style.alignSelf = 'start';
    card.style.flex = '0 0 auto'; card.style.maxWidth = 'none'; card.style.maxHeight = 'none';
    card.style.boxSizing = 'border-box';
  }

  // ── attach ──────────────────────────────────────────────────────────────────
  function attach(card) {
    if (card.__shimonAttached) return;
    card.__shimonAttached = true;
    const id = slotId(card);
    card.dataset.shimonSlot = id;

    const ccs = getComputedStyle(card);
    if (ccs.position === 'static') card.style.position = 'relative';
    // CSS ignores `transform` on display:inline elements — some wrapped cards
    // (e.g. one inside a swipe/carousel) render inline, so the handle appears but
    // dragging silently never moves them. Force a transformable display.
    if (ccs.display === 'inline') card.style.display = 'inline-block';
    card.style.overflow = 'visible';
    unclip(card);

    const inner = innerOf(card);
    if (inner) inner.style.overflow = 'visible';

    const host = handleHost(card);   // shadow content box for slot-less cards

    const grip = document.createElement('div');
    grip.className = 'shimon-grip'; grip.title = t('drag');
    css(grip, editing() ? gripStyle(card.offsetWidth || 200) : OFF);
    host.appendChild(grip);

    const resize = document.createElement('div');
    resize.className = 'shimon-resize'; resize.title = t('resize');
    css(resize, editing() ? resizeStyle(card.offsetWidth || 200) : OFF);
    host.appendChild(resize);

    const rec = { card, grip, resize, host, slotId: id };
    HANDLES.push(rec);

    grip.addEventListener('pointerdown', e => beginDrag(e, rec));
    resize.addEventListener('pointerdown', e => beginResize(e, rec));

    // live smart-fit on any size change
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (card.__shimonSized) {           // only fit cards the user has resized
          cancelAnimationFrame(card.__shimonRaf);
          card.__shimonRaf = requestAnimationFrame(() => fit(card));
        }
      });
      ro.observe(card);
      card.__shimonRO = ro;
    }

    const pos = load(id);
    if (pos) { card.__shimonSized = (pos.w != null); applyStored(card, pos); }
  }

  function detach(card) {
    if (!card.__shimonAttached) return;
    card.__shimonAttached = false;
    card.__shimonScroll = undefined;            // re-evaluate scroll/marquee next time
    const rec = HANDLES.find(h => h.card === card);
    if (rec) { rec.grip.remove(); rec.resize.remove(); }
    card.querySelectorAll(':scope > .shimon-grip, :scope > .shimon-resize').forEach(e => e.remove());
    if (card.__shimonRO) { card.__shimonRO.disconnect(); card.__shimonRO = null; }
    HANDLES = HANDLES.filter(h => h.card !== card);
  }

  // ── drag (transform) ────────────────────────────────────────────────────────
  function pushUndo(slot) { UNDO.push({ slot, prev: load(slot) }); if (UNDO.length > 60) UNDO.shift(); REDO.length = 0; updateUndo(); }

  function beginDrag(e, rec) {
    if (!editing()) return;
    const card = rec.card;
    if (card.__shimonBusy) return;
    card.__shimonBusy = true;
    e.preventDefault(); e.stopPropagation();
    try { rec.grip.setPointerCapture(e.pointerId); } catch {}
    rec.grip.style.transform = 'translateX(-50%) scale(1.15)';
    card.style.zIndex = '999';
    card.style.boxShadow = '0 14px 40px rgba(0,0,0,.55),0 0 0 2px rgba(120,180,255,.7)';

    showGrid(); unclip(card);
    const t0 = getT(card);
    const r0 = card.getBoundingClientRect();
    const baseL = r0.left - t0.tx, baseT = r0.top - t0.ty, w = r0.width, h = r0.height;
    const sx = e.clientX, sy = e.clientY;
    let moved = false, pushed = false;

    // Group drag: if this card is part of a multi-selection, move them all by
    // the same delta (snap disabled for the group so they stay rigid).
    const group = (SELECTED.size > 1 && SELECTED.has(card))
      ? [...SELECTED].map(c => ({ c, t: getT(c) }))
      : null;

    const move = ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 2 && Math.abs(ev.clientY - sy) < 2) return;
      if (!pushed) {
        if (group) group.forEach(g => pushUndo(g.c.dataset.shimonSlot));
        else pushUndo(rec.slotId);
        pushed = true;
      }
      moved = true;
      const dx = snap(ev.clientX - sx), dy = snap(ev.clientY - sy);
      if (group) {
        clearLines();
        for (const g of group) setT(g.c, g.t.tx + dx, g.t.ty + dy);
        return;
      }
      let tx = snap(t0.tx + ev.clientX - sx), ty = snap(t0.ty + ev.clientY - sy);
      if (!ev.shiftKey) {
        const adj = computeSnap(card, baseL + tx, baseT + ty, w, h);
        tx += adj.dx; ty += adj.dy;
      } else clearLines();
      setT(card, tx, ty);
    };
    const up = () => {
      window.removeEventListener('blur', up);
      document.removeEventListener('visibilitychange', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      rec.grip.style.transform = 'translateX(-50%)';
      card.style.zIndex = (card.__shimonZ != null) ? card.__shimonZ : '';
      card.style.transition = 'box-shadow .25s ease';
      card.style.boxShadow = '';
      setTimeout(() => card.style.transition = '', 260);
      hideGrid(); clearLines();
      card.__shimonBusy = false;
      if (moved) {
        if (group) group.forEach(g => save(g.c.dataset.shimonSlot, currentEntry(g.c)));
        else save(rec.slotId, currentEntry(card));
      }
    };
    // Listen on window (not the grip) so a release anywhere — even if pointer
    // capture silently failed on touch — always ends the drag and clears the
    // re-entrancy guard. No more "stuck" cards.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    document.addEventListener('visibilitychange', up);
  }

  // ── resize (width/height + smart fit) ───────────────────────────────────────
  function beginResize(e, rec) {
    if (!editing()) return;
    const card = rec.card;
    if (card.__shimonBusy) return;
    card.__shimonBusy = true;
    e.preventDefault(); e.stopPropagation();
    try { rec.resize.setPointerCapture(e.pointerId); } catch {}
    card.style.zIndex = '999';
    card.style.boxShadow = '0 12px 30px rgba(0,0,0,.55),0 0 0 2px rgba(255,209,102,.7)';

    showGrid(); unclip(card);
    // Capture the CURRENT rendered size BEFORE sizeMode (justify-self:start
    // would otherwise collapse a grid/flex item to its content width), then
    // lock it so the resize starts exactly where the card visually is.
    const r0 = card.getBoundingClientRect();
    const ow = Math.round(r0.width), oh = Math.round(r0.height);
    // Remember the card's NATURAL size the first time it's ever resized — the
    // grow-content math measures enlargement relative to this baseline.
    if (!card.__shimonSized && card.__shimonNatW == null) { card.__shimonNatW = ow; card.__shimonNatH = oh; }
    sizeMode(card);
    card.style.width = ow + 'px';
    card.style.height = oh + 'px';
    const sx = e.clientX, sy = e.clientY;
    let moved = false, pushed = false;

    card.__shimonScroll = undefined;             // re-evaluate marquee/scroll now that the user is sizing
    const move = ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 2 && Math.abs(ev.clientY - sy) < 2) return;
      if (!pushed) { pushUndo(rec.slotId); pushed = true; }
      moved = true; card.__shimonSized = true;
      card.style.width  = Math.max(MIN_W, snap(ow + ev.clientX - sx)) + 'px';
      card.style.height = Math.max(MIN_H, snap(oh + ev.clientY - sy)) + 'px';
      // Coalesce the (reflow-heavy) smart-fit to one call per frame.
      cancelAnimationFrame(card.__shimonRaf);
      card.__shimonRaf = requestAnimationFrame(() => fit(card));
    };
    const up = () => {
      window.removeEventListener('blur', up);
      document.removeEventListener('visibilitychange', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      card.style.zIndex = (card.__shimonZ != null) ? card.__shimonZ : '';
      card.style.transition = 'box-shadow .25s ease';
      card.style.boxShadow = '';
      setTimeout(() => card.style.transition = '', 260);
      hideGrid();
      card.__shimonBusy = false;
      fit(card);                                  // final exact fit
      hugBox(card);                               // remove empty space so the frame hugs the (enlarged) content
      fit(card);                                  // re-fit inside the hugged box
      if (moved) save(rec.slotId, currentEntry(card));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    document.addEventListener('visibilitychange', up);
  }

  // ── undo ──────────────────────────────────────────────────────────────────────
  // apply a stored entry (or null = pristine) to a slot's card, and persist it
  function applyEntry(slot, entry) {
    const rec = HANDLES.find(h => h.slotId === slot);
    if (!rec) return;
    const card = rec.card;
    if (entry) {
      card.__shimonSized = (entry.w != null);
      applyStored(card, entry);
      save(slot, entry);
    } else {
      resetCardLayout(card);
      const inner = innerOf(card);
      if (inner) { inner.style.zoom = ''; inner.style.transform = ''; inner.style.width = ''; inner.style.height = ''; }
      save(slot, null);
    }
    Sync.flushNow();
  }
  function undo() {
    const last = UNDO.pop();
    if (!last) return;
    REDO.push({ slot: last.slot, prev: load(last.slot) });   // remember current state so we can redo
    applyEntry(last.slot, last.prev);
    updateUndo();
  }
  function redo() {
    const r = REDO.pop();
    if (!r) return;
    UNDO.push({ slot: r.slot, prev: load(r.slot) });          // remember current state so we can undo again
    applyEntry(r.slot, r.prev);
    updateUndo();
  }
  function updateUndo() {
    const u = document.getElementById('shimon-undo');
    if (u) { u.style.opacity = UNDO.length ? '1' : '.35'; u.style.pointerEvents = UNDO.length ? 'auto' : 'none'; }
    const rd = document.getElementById('shimon-redo');
    if (rd) { rd.style.opacity = REDO.length ? '1' : '.35'; rd.style.pointerEvents = REDO.length ? 'auto' : 'none'; }
  }

  // ── scan ────────────────────────────────────────────────────────────────────
  function scan() {
    if (!inScope()) return;
    purge();
    let all;
    try { all = findAll(); } catch { return; }
    const keep = new Set(leaves(all));
    // detach anything previously attached that is no longer a leaf
    for (const h of [...HANDLES]) if (!keep.has(h.card)) { try { detach(h.card); } catch {} }
    // Attach each leaf in isolation: a single incompatible community card that
    // throws must NOT prevent every later card from getting its handles.
    for (const c of keep) { try { attach(c); } catch (e) { /* skip this card, keep going */ } }
  }

  let obs = null, obsT = null;
  function observe() {
    if (obs) return;
    obs = new MutationObserver(muts => {
      // Ignore non-structural churn (a ticking clock, a progress bar, live
      // text feeds) — only rescan when ELEMENT nodes are actually added, so an
      // always-on tablet isn't re-scanning the whole shadow tree every second.
      let structural = false;
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) { structural = true; break; }
        if (structural) break;
      }
      if (!structural) return;
      clearTimeout(obsT);
      obsT = setTimeout(() => { if (inScope()) scan(); }, editing() ? 350 : 1500);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── keyframes ───────────────────────────────────────────────────────────────
  (function kf() {
    if (document.getElementById('shimon-kf')) return;
    const s = document.createElement('style'); s.id = 'shimon-kf';
    s.textContent = `
      @keyframes shimonPulse{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 0 0 rgba(95,178,122,.55)}50%{box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 0 7px rgba(95,178,122,0)}}
      #shimon-toggle,#shimon-undo{transition:width .15s,height .15s,opacity .15s,transform .18s cubic-bezier(.4,1.5,.6,1),left .15s,top .15s,bottom .15s}
      @media(max-width:870px){
        #shimon-toggle{left:10px!important;bottom:18px!important;top:auto!important;width:42px!important;height:42px!important;opacity:.85!important}
        #shimon-undo{left:62px!important;bottom:18px!important;top:auto!important;width:42px!important;height:42px!important}
      }
      @media(min-width:871px) and (max-width:1279px){
        #shimon-toggle{left:70px!important;width:26px!important;height:26px!important}
        #shimon-undo{left:104px!important;width:30px!important;height:30px!important}
      }`;
    document.head.appendChild(s);
  })();

  // ── tiny toggle + undo ──────────────────────────────────────────────────────
  const RED   = 'radial-gradient(circle at 35% 30%,rgba(255,140,140,.92),rgba(204,72,72,.92) 60%,rgba(140,38,38,.92))';
  const GREEN = 'radial-gradient(circle at 35% 30%,#9ee9b3,#43ad60 60%,#1f7d3a)';
  const BLUE  = 'radial-gradient(circle at 35% 30%,#b8dcff,#4a90e2 60%,#1c5fa4)';
  let clicks = 0, clickT = null;

  function installToggle() {
    if (!inScope() || document.getElementById('shimon-toggle')) return;
    const b = document.createElement('button');
    b.id = 'shimon-toggle';
    Object.assign(b.style, {
      position: 'fixed', top: '64px', left: '264px', width: '16px', height: '16px',
      borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: '999998',
      background: RED, opacity: '.5', padding: '0', outline: 'none',
      boxShadow: '0 2px 6px rgba(0,0,0,.4),inset 0 1px 1px rgba(255,255,255,.4)',
    });
    b.title = t('toggle');
    b.addEventListener('mouseenter', () => { b.style.transform = 'scale(1.5)'; b.style.opacity = '1'; });
    b.addEventListener('mouseleave', () => { b.style.transform = ''; b.style.opacity = editing() ? '1' : '.5'; });
    b.addEventListener('click', () => {
      clicks++; clearTimeout(clickT);
      clickT = setTimeout(() => { (clicks >= 3) ? rescue() : toggle(); clicks = 0; }, 240);
    });
    document.body.appendChild(b);
  }

  // First-run coachmark: a stranger will never find a 16px ghost dot on their
  // own. Show a one-time auto-dismissing hint that points at the toggle. Guarded
  // by a localStorage flag so it appears exactly once.
  function showCoach() {
    try { if (localStorage.getItem('shimon-ff-coach')) return; } catch {}
    const b = document.getElementById('shimon-toggle');
    if (!b || document.getElementById('shimon-coach')) return;
    const r = b.getBoundingClientRect();
    const c = document.createElement('div');
    c.id = 'shimon-coach';
    c.textContent = t('coach');
    c.style.direction = uiDir();
    Object.assign(c.style, {
      position: 'fixed', top: (r.bottom + 10) + 'px', left: Math.max(8, r.left - 12) + 'px',
      zIndex: '2147483600', maxWidth: '240px', padding: '9px 13px', borderRadius: '12px',
      background: 'linear-gradient(135deg,#4f6cf0,#3a52d8)', color: '#fff',
      font: '700 13px Heebo,Assistant,system-ui,sans-serif', boxShadow: '0 8px 26px rgba(0,0,0,.4)',
      opacity: '0', transform: 'translateY(-6px)',
      transition: 'opacity .25s ease, transform .25s ease', cursor: 'pointer', pointerEvents: 'auto',
    });
    document.body.appendChild(c);
    requestAnimationFrame(() => { c.style.opacity = '1'; c.style.transform = 'translateY(0)'; });
    const dismiss = () => { try { localStorage.setItem('shimon-ff-coach', '1'); } catch {} c.style.opacity = '0'; setTimeout(() => c.remove(), 300); };
    c.addEventListener('click', dismiss);
    b.addEventListener('pointerdown', dismiss, { once: true });
    setTimeout(dismiss, 9000);
  }
  function toggle() {
    const b = document.getElementById('shimon-toggle');
    if (!b) return;
    if (editing()) {
      delete document.body.dataset.shimonEdit;
      b.style.background = RED; b.style.animation = ''; b.style.opacity = '.5';
      b.style.width = '16px'; b.style.height = '16px';
      showHandles(false); hideGrid(); clearLines(); clearSelection(); setDragRoom(false);
      const u = document.getElementById('shimon-undo'); if (u) u.style.display = 'none';
      const rd0 = document.getElementById('shimon-redo'); if (rd0) rd0.style.display = 'none';
      _tapCard = null; _tapTime = 0;     // don't let a stale tap trigger a cross-session double-click
      if (scenesBar) scenesBar.style.display = 'none';
    } else {
      document.body.dataset.shimonEdit = '1';
      b.style.background = GREEN; b.style.animation = 'shimonPulse 1.8s ease-in-out infinite';
      b.style.opacity = '1'; b.style.width = '20px'; b.style.height = '20px';
      // Fresh edit session → fresh undo history. Once you lock (save), re-opening
      // edit must NOT let you undo changes from before the save.
      UNDO.length = 0;
      scan(); showHandles(true); setDragRoom(true); grabHass(); installUndo(); renderScenesBar();
    }
  }
  function installUndo() {
    let u = document.getElementById('shimon-undo');
    if (u) { u.style.display = 'flex'; updateUndo(); return; }
    u = document.createElement('button'); u.id = 'shimon-undo';
    Object.assign(u.style, {
      position: 'fixed', top: '64px', left: '292px', width: '20px', height: '20px',
      borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: '999998',
      background: BLUE, color: '#fff', fontSize: '13px', fontWeight: '900', lineHeight: '20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '.35', pointerEvents: 'none',
      padding: '0', outline: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.4),inset 0 1px 1px rgba(255,255,255,.4)',
    });
    u.title = t('undo'); u.innerHTML = '↶';
    u.addEventListener('mouseenter', () => u.style.transform = 'scale(1.25)');
    u.addEventListener('mouseleave', () => u.style.transform = '');
    u.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); undo(); });
    document.body.appendChild(u);
    // redo, just to the right of undo
    if (!document.getElementById('shimon-redo')) {
      const rd = document.createElement('button'); rd.id = 'shimon-redo';
      Object.assign(rd.style, {
        position: 'fixed', top: '64px', left: '316px', width: '20px', height: '20px',
        borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: '999998',
        background: BLUE, color: '#fff', fontSize: '13px', fontWeight: '900', lineHeight: '20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '.35', pointerEvents: 'none',
        padding: '0', outline: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.4),inset 0 1px 1px rgba(255,255,255,.4)',
      });
      rd.title = t('redo'); rd.innerHTML = '↷';
      rd.addEventListener('mouseenter', () => rd.style.transform = 'scale(1.25)');
      rd.addEventListener('mouseleave', () => rd.style.transform = '');
      rd.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); redo(); });
      document.body.appendChild(rd);
    } else { document.getElementById('shimon-redo').style.display = 'flex'; }
    updateUndo();
  }
  function uninstall() {
    document.getElementById('shimon-toggle')?.remove();
    document.getElementById('shimon-undo')?.remove();
    document.getElementById('shimon-redo')?.remove();
    // Tear down observers + per-card ResizeObservers so navigating away from
    // the dashboard doesn't leak watchers across the SPA's lifetime.
    if (obs) { obs.disconnect(); obs = null; }
    for (const h of [...HANDLES]) detach(h.card);
    setDragRoom(false);   // drop the edit-mode scroll room
    reclip();             // restore overflow/contain/clip we forced on HA's containers
    delete document.body.dataset.shimonEdit;
  }

  function rescue() {
    purge();
    let n = 0;
    for (const h of HANDLES) {
      const card = h.card, r = card.getBoundingClientRect();
      const offscreen = r.right < 20 || r.bottom < 20 || r.left > innerWidth - 20 || r.top > innerHeight * 2;
      const tooSmall = card.__shimonSized && (card.offsetWidth < MIN_W + 8 || card.offsetHeight < MIN_H + 8);
      if (offscreen || tooSmall) {
        resetCardLayout(card);
        const inner = innerOf(card);
        if (inner) { inner.style.zoom = ''; inner.style.transform = ''; inner.style.width = ''; inner.style.height = ''; }
        save(h.slotId, null);
        n++;
      }
    }
    const b = document.getElementById('shimon-toggle');
    if (b) { const g = b.style.background; b.style.background = 'radial-gradient(circle,#fff,#ffd166)'; setTimeout(() => b.style.background = g, 600); }
    toast(n ? t('toastRescued', n) : t('toastNothing'));   // visible confirmation either way
    console.info(`[shimon-freeform] rescued ${n} cards`);
  }

  function grabHass() {
    // Fast path: the HA root element exposes the live hass object.
    const ha = document.querySelector('home-assistant');
    if (ha && ha.hass) { Sync.setHass(ha.hass); hydrate(); return; }
    for (const c of findAll()) {
      if (c.hass) { Sync.setHass(c.hass); hydrate(); return; }
      const host = c.getRootNode().host;
      if (host && host.hass) { Sync.setHass(host.hass); hydrate(); return; }
    }
  }
  async function hydrate() {
    const data = await Sync.loadAll();
    if (!data) return;
    // First pass: the meta record (scene list + active scene).
    if (data[META_KEY] && data[META_KEY].scenes) {
      SCENES = validateScenes(data[META_KEY].scenes);
      activeScene = (typeof data[META_KEY].active === 'string' && SCENES.includes(data[META_KEY].active)) ? data[META_KEY].active : SCENES[0];
      saveMeta();                       // mirror to localStorage
      renderScenesBar();
    }
    // Second pass: mirror every scene-namespaced card record into localStorage…
    for (const [key, rec] of Object.entries(data)) {
      if (key === META_KEY) continue;
      if (!rec || rec.f !== STORE_FMT || !rec.bp) continue;
      try { localStorage.setItem(prefix() + key, JSON.stringify(rec)); } catch {}
    }
    // …then apply the entries for the ACTIVE scene + this device's breakpoint.
    for (const h of HANDLES) {
      const entry = load(h.slotId);
      if (entry) { h.card.__shimonSized = (entry.w != null); applyStored(h.card, entry); }
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  let lastPath = location.pathname, hbTick = 0, hbCount = -1;
  function onPath() {
    if (inScope()) {
      installToggle(); observe();
      hbCount = -1;                       // force the heartbeat to rescan after a route change
      setTimeout(scan, 300); setTimeout(scan, 1200); setTimeout(scan, 3000); setTimeout(scan, 6000);
      setTimeout(grabHass, 1500);
      setTimeout(showCoach, 2500);        // one-time "tap here to edit" hint for first-timers
    } else uninstall();
  }
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; onPath(); return; }
    if (!inScope()) return;
    // HEARTBEAT (~every 2 s): the MutationObserver on document.body cannot see
    // cards that mount LATE inside their own shadow root (camera streams,
    // swipe-cards, slow integrations) — so those cards never got handles until a
    // manual re-toggle. We poll the candidate-card count and rescan only when it
    // changes or an attached card disconnected. scan() is purge+guard idempotent.
    if (++hbTick % 5 === 0) {
      let n = -1; try { n = findAll().length; } catch {}
      const dead = HANDLES.some(h => !h.card.isConnected);
      if (n !== hbCount || dead) { hbCount = n; scan(); }
      // If the user opened HA's OWN native editor (the pencil), suspend our
      // overlay so the two editors don't fight over the same cards.
      if (editing()) { try { const root = huiRootEl(); if (root && root.lovelace && root.lovelace.editMode) toggle(); } catch {} }
    }
    // Re-assert position HA may have wiped when it re-rendered a card on a state
    // change (the card silently jumps back to its flow spot). We hold the
    // transform in memory, so restoring it is cheap and needs no storage read.
    for (const h of HANDLES) {
      const c = h.card;
      if (c.__shimonBusy) continue;
      const t = c.__shimonT;
      if (t && (t.tx || t.ty) && (!c.style.transform || c.style.transform === 'none')) {
        try { applyTransform(c); } catch {}
      }
    }
  }, 400);
  onPath();

  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!inScope()) return;
    if ((e.key === 'e' || e.key === 'E') && !editing()) toggle();
    if (e.key === 'Escape' && editing()) { clearSelection(); toggle(); }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && editing()) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey) && editing()) { e.preventDefault(); redo(); }
    // arrow-key nudge of the current selection (Shift = one grid cell)
    if (editing() && SELECTED.size && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? GRID : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) nudge(d[0], d[1]);
    }
  });

  // ── breakpoint switching: re-apply the right layout when the screen class
  //    changes (rotate iPad, resize window) ────────────────────────────────────
  let lastBP = currentBP(), bpTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(bpTimer);
    bpTimer = setTimeout(() => {
      const bp = currentBP();
      if (bp !== lastBP && inScope()) { lastBP = bp; reapplyAll(); }
    }, 300);
  });
  function reapplyAll() {
    purge();
    for (const h of HANDLES) {
      resetCardLayout(h.card);
      const inner = innerOf(h.card);
      if (inner) { inner.style.zoom = ''; inner.style.transform = ''; inner.style.width = ''; inner.style.height = ''; }
      const entry = load(h.slotId);
      if (entry) { h.card.__shimonSized = (entry.w != null); applyStored(h.card, entry); }
    }
  }

  // ── selection + per-card style panel (no-YAML design) ───────────────────────
  const SELECTED = new Set();
  const SEL_OUTLINE = '2px solid #4f6cf0';
  const EDIT_OUTLINE = '1px solid rgba(255,255,255,.22)';

  // ── style "format painter": copy one card's look, paint it onto others ──────
  let styleClipboard = null;
  function pasteStyleToSelection() {
    if (!styleClipboard || !SELECTED.size) return;
    for (const card of SELECTED) {
      pushUndo(card.dataset.shimonSlot);
      applyCardStyle(card, normalizeStyle({ ...DEFAULT_STYLE, ...styleClipboard }));
      save(card.dataset.shimonSlot, currentEntry(card));
    }
    updateStylePanel();
    toast(t('toastPasted'));
  }

  function clearSelection() {
    for (const c of SELECTED) { c.style.outline = editing() ? EDIT_OUTLINE : ''; c.style.outlineOffset = '-1px'; }
    SELECTED.clear();
    updateStylePanel(); updateAlignBar();
  }
  function selectCard(card, additive) {
    if (!additive) {
      for (const c of SELECTED) { c.style.outline = EDIT_OUTLINE; }
      SELECTED.clear();
    }
    if (additive && SELECTED.has(card)) { SELECTED.delete(card); card.style.outline = EDIT_OUTLINE; }
    else { SELECTED.add(card); card.style.outline = SEL_OUTLINE; card.style.outlineOffset = '-1px'; }
    updateStylePanel(); updateAlignBar();
  }

  // ── open Home Assistant's REAL native card editor ───────────────────────────
  // Double-clicking a card drops into HA's own dashboard editor, where the card
  // is fully editable — entity, type, options, add,
  // delete. We use the live lovelace object's documented setEditMode(), so it's
  // 100% native and reversible; nothing is saved unless the user edits + saves.
  function huiRootEl() {
    const stack = [document.documentElement];
    while (stack.length) {
      const el = stack.shift(); if (!el) continue;
      if (el.tagName && el.tagName.toLowerCase() === 'hui-root') return el;
      if (el.shadowRoot) stack.push(...el.shadowRoot.children);
      if (el.children) stack.push(...el.children);
    }
    return null;
  }
  function openNativeEditor(card) {
    const root = huiRootEl();
    if (!root || !root.lovelace || typeof root.lovelace.setEditMode !== 'function') return false;
    if (editing()) toggle();        // leave freeform mode so the two editors don't fight
    clearSelection();
    try { root.lovelace.setEditMode(true); } catch (e) { return false; }
    if (card && card.scrollIntoView) setTimeout(() => { try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }, 350);
    return true;
  }

  // capture-phase: clicking a card body in edit mode selects it (and suppresses
  // HA's more-info, since you're arranging, not operating). DOUBLE-click opens
  // the real HA editor. Clicking empty canvas starts a rubber-band multi-select.
  let _tapCard = null, _tapTime = 0, _touch = null;
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  window.addEventListener('pointerdown', e => {
    if (!editing()) return;
    const path = e.composedPath();
    for (const el of path) {
      if (!el.classList) continue;
      if (el.classList.contains('shimon-grip') || el.classList.contains('shimon-resize')) return;
      if (el.id === 'shimon-toggle' || el.id === 'shimon-undo' || el.id === 'shimon-scenes-bar' ||
          el.id === 'shimon-style-panel' || el.id === 'shimon-align-bar') return;
    }
    const card = path.find(el => el.__shimonAttached);
    if (!card) {
      // Empty canvas → marquee on MOUSE only. On touch we must NOT hijack the
      // gesture, or the page can't be scrolled while editing.
      if (e.pointerType === 'mouse') startRubberBand(e);
      return;
    }
    // (locked cards keep their handles hidden so they can't be dragged/resized,
    // but stay selectable in edit mode so you can reach the unlock button; in
    // VIEW mode this whole handler is inert, so they operate normally there.)
    if (e.pointerType !== 'mouse') {
      // TOUCH: don't preventDefault — the finger might be scrolling. We decide
      // select-vs-scroll on release, so the dashboard stays scrollable in edit.
      _touch = { card, x: e.clientX, y: e.clientY, shift: e.shiftKey, id: e.pointerId };
      return;
    }
    // MOUSE: select immediately + suppress HA more-info; double-click → editor.
    e.preventDefault(); e.stopPropagation();
    const now = nowMs();
    if (card === _tapCard && (now - _tapTime) < 420) { _tapCard = null; _tapTime = 0; openNativeEditor(card); return; }
    _tapCard = card; _tapTime = now;
    selectCard(card, e.shiftKey);
  }, true);

  // TOUCH selection is decided on release: a stationary tap selects (double-tap
  // opens the editor); a finger that moved was a scroll, so we leave it be.
  window.addEventListener('pointerup', e => {
    if (!_touch || e.pointerId !== _touch.id) return;
    const ts = _touch; _touch = null;
    if (!editing()) return;
    if (Math.abs(e.clientX - ts.x) > 12 || Math.abs(e.clientY - ts.y) > 12) return;   // was a scroll
    // suppress the click that would otherwise pop HA's more-info on this tap
    const kill = ev => { ev.preventDefault(); ev.stopPropagation(); window.removeEventListener('click', kill, true); };
    window.addEventListener('click', kill, true);
    setTimeout(() => window.removeEventListener('click', kill, true), 450);
    const now = nowMs();
    if (ts.card === _tapCard && (now - _tapTime) < 480) { _tapCard = null; _tapTime = 0; openNativeEditor(ts.card); return; }
    _tapCard = ts.card; _tapTime = now;
    selectCard(ts.card, ts.shift);
  }, true);

  // ── rubber-band marquee selection ───────────────────────────────────────────
  function startRubberBand(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const sx = e.clientX, sy = e.clientY;
    let band = null, moved = false;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      if (!band) {
        band = document.createElement('div');
        Object.assign(band.style, {
          position: 'fixed', zIndex: '2147483500', pointerEvents: 'none',
          border: '1.5px solid #4f6cf0', background: 'rgba(79,108,240,.12)', borderRadius: '4px',
        });
        document.body.appendChild(band);
      }
      const l = Math.min(sx, ev.clientX), t = Math.min(sy, ev.clientY);
      band.style.left = l + 'px'; band.style.top = t + 'px';
      band.style.width = Math.abs(dx) + 'px'; band.style.height = Math.abs(dy) + 'px';
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved && band) {
        const r = band.getBoundingClientRect();
        for (const h of HANDLES) {
          const cr = h.card.getBoundingClientRect();
          const hit = cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
          if (hit) selectCard(h.card, true);
        }
      } else {
        clearSelection();
      }
      if (band) band.remove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── group geometry helpers (align / distribute / nudge / z-order) ───────────
  function selectedCards() { return [...SELECTED]; }
  function cardLeftTop(card) {              // current viewport-left/top
    const r = card.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }
  function moveCardTo(card, vx, vy) {       // set viewport-left/top via translate (EXACT — align is precise, no grid snap)
    const g = cardLeftTop(card), tr = getT(card);
    const baseL = g.l - tr.tx, baseT = g.t - tr.ty;
    setT(card, Math.round(vx - baseL), Math.round(vy - baseT));
  }
  function nudge(dx, dy) {
    for (const c of SELECTED) {
      const tr = getT(c);
      setT(c, tr.tx + dx, tr.ty + dy);
      save(c.dataset.shimonSlot, currentEntry(c));
    }
  }
  function alignSelected(kind) {
    const cs = selectedCards(); if (cs.length < 2) return;
    cs.forEach(c => pushUndo(c.dataset.shimonSlot));
    const g = cs.map(cardLeftTop);
    if (kind === 'left')   { const m = Math.min(...g.map(x => x.l)); cs.forEach((c, i) => moveCardTo(c, m, g[i].t)); }
    if (kind === 'right')  { const m = Math.max(...g.map(x => x.r)); cs.forEach((c, i) => moveCardTo(c, m - g[i].w, g[i].t)); }
    if (kind === 'hcenter'){ const m = (Math.min(...g.map(x=>x.l)) + Math.max(...g.map(x=>x.r)))/2; cs.forEach((c,i)=>moveCardTo(c, m - g[i].w/2, g[i].t)); }
    if (kind === 'top')    { const m = Math.min(...g.map(x => x.t)); cs.forEach((c, i) => moveCardTo(c, g[i].l, m)); }
    if (kind === 'bottom') { const m = Math.max(...g.map(x => x.b)); cs.forEach((c, i) => moveCardTo(c, g[i].l, m - g[i].h)); }
    if (kind === 'vcenter'){ const m = (Math.min(...g.map(x=>x.t)) + Math.max(...g.map(x=>x.b)))/2; cs.forEach((c,i)=>moveCardTo(c, g[i].l, m - g[i].h/2)); }
    if (kind === 'hdist' && cs.length >= 3) {
      const sorted = cs.map((c,i)=>({c,g:g[i]})).sort((a,b)=>a.g.l-b.g.l);
      const lo = sorted[0].g.l, hi = sorted[sorted.length-1].g.r;
      const totalW = sorted.reduce((s,x)=>s+x.g.w,0);
      const gap = (hi - lo - totalW) / (sorted.length - 1);
      let x = lo; for (const s of sorted) { moveCardTo(s.c, x, s.g.t); x += s.g.w + gap; }
    }
    if (kind === 'vdist' && cs.length >= 3) {
      const sorted = cs.map((c,i)=>({c,g:g[i]})).sort((a,b)=>a.g.t-b.g.t);
      const lo = sorted[0].g.t, hi = sorted[sorted.length-1].g.b;
      const totalH = sorted.reduce((s,x)=>s+x.g.h,0);
      const gap = (hi - lo - totalH) / (sorted.length - 1);
      let y = lo; for (const s of sorted) { moveCardTo(s.c, s.g.l, y); y += s.g.h + gap; }
    }
    cs.forEach(c => save(c.dataset.shimonSlot, currentEntry(c)));
  }
  let zTop = 10;
  function setZ(kind) {
    for (const c of SELECTED) {
      const z = kind === 'front' ? (++zTop) : (-(++zTop));
      c.__shimonZ = z;
      c.style.zIndex = z;
      save(c.dataset.shimonSlot, currentEntry(c));
    }
  }

  const STYLE_FIELDS = [
    { key: 'opacity', emoji: '👁', labelKey: 'opacity', min: 20, max: 100, step: 5, def: 100, unit: '%' },
    { key: 'blur',    emoji: '🌫', labelKey: 'blur',    min: 0,  max: 24,  step: 1, def: 0,   unit: 'px' },
    { key: 'radius',  emoji: '⬭', labelKey: 'corners',  min: 0,  max: 40,  step: 1, def: 12,  unit: 'px' },
    { key: 'shadow',  emoji: '🌑', labelKey: 'shadow',  min: 0,  max: 30,  step: 1, def: 0,   unit: 'px' },
    { key: 'rotate',  emoji: '↻', labelKey: 'rotate',   min: -45, max: 45, step: 1, def: 0,   unit: '°' },
  ];
  const BG_SWATCHES = ['', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.35)',
    'linear-gradient(135deg,#5b2a86,#0b3c5d)', 'linear-gradient(135deg,#ff9a9e,#fad0c4)',
    'linear-gradient(135deg,#4facfe,#00f2fe)', 'linear-gradient(135deg,#43ad60,#1f7d3a)'];

  // One-tap looks. Each fully replaces the card's style with a curated set so a
  // single click transforms the card — no slider fiddling. Reuses applyCardStyle.
  const PRESETS = [
    { nameKey: 'presetGlass', emoji: '🧊', style: { opacity: 100, blur: 14, radius: 22, shadow: 12, rotate: 0, bg: 'rgba(255,255,255,0.10)' } },
    { nameKey: 'presetDark',  emoji: '🌑', style: { opacity: 100, blur: 4,  radius: 18, shadow: 16, rotate: 0, bg: 'rgba(12,14,22,0.80)' } },
    { nameKey: 'presetNeon',  emoji: '⚡', style: { opacity: 100, blur: 6,  radius: 18, shadow: 24, rotate: 0, bg: 'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)' } },
    { nameKey: 'presetFrame', emoji: '🖼', style: { opacity: 100, blur: 0,  radius: 8,  shadow: 18, rotate: 0, bg: 'rgba(255,255,255,0.94)' } },
    { nameKey: 'presetGhost', emoji: '👻', style: { opacity: 55,  blur: 0,  radius: 14, shadow: 0,  rotate: 0, bg: '' } },
    { nameKey: 'presetClean', emoji: '⬜', style: { ...DEFAULT_STYLE } },
  ];

  let stylePanel = null;
  function buildStylePanel() {
    if (stylePanel) return stylePanel;
    const p = document.createElement('div');
    p.id = 'shimon-style-panel';
    Object.assign(p.style, {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
      zIndex: '2147483600', display: 'none', opacity: '0',
      background: 'linear-gradient(135deg,rgba(28,32,54,.96),rgba(18,20,38,.96))',
      backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
      border: '1px solid rgba(255,255,255,.16)', borderRadius: '18px',
      boxShadow: '0 14px 44px rgba(0,0,0,.55)', padding: '12px 16px',
      color: '#f0f4ff', font: '600 12px/1.2 Heebo,Assistant,system-ui,sans-serif',
      direction: uiDir(), transition: 'opacity .2s ease, transform .2s cubic-bezier(.34,1.4,.6,1)',
      maxWidth: '94vw', display: 'none',
    });
    const sliders = STYLE_FIELDS.map(f => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:78px;">
        <span style="font-size:11px;opacity:.85;white-space:nowrap;">${f.emoji} ${t(f.labelKey)}</span>
        <input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}"
          style="width:84px;accent-color:#6c8cff;cursor:pointer;">
        <span class="val" data-v="${f.key}" style="font-size:10px;opacity:.6;">${f.def}${f.unit}</span>
      </label>`).join('');
    const swatches = BG_SWATCHES.map((b, i) =>
      `<button data-bg="${i}" title="${t('bg')}" style="width:22px;height:22px;border-radius:6px;cursor:pointer;
        border:1.5px solid rgba(255,255,255,.4);background:${b || 'transparent'};
        ${b ? '' : 'background-image:linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),linear-gradient(45deg,#888 25%,#ccc 25%,#ccc 75%,#888 75%);background-size:8px 8px;background-position:0 0,4px 4px;'}"></button>`
    ).join('') +
      `<label title="${t('customColor')}" style="width:22px;height:22px;border-radius:6px;cursor:pointer;overflow:hidden;
        border:1.5px solid rgba(255,255,255,.4);display:inline-flex;position:relative;
        background:conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red);">
        <input type="color" id="shimon-bg-color" style="position:absolute;inset:-6px;width:200%;height:200%;border:none;padding:0;cursor:pointer;opacity:0;"></label>`;
    const presetBtns = PRESETS.map((pr, i) =>
      `<button data-preset="${i}" title="${t(pr.nameKey)}" style="border:1px solid rgba(255,255,255,.18);border-radius:11px;
        padding:7px 11px;cursor:pointer;font:700 12px Heebo,sans-serif;color:#eaf0ff;background:rgba(255,255,255,.07);
        display:inline-flex;align-items:center;gap:5px;white-space:nowrap;transition:background .15s,transform .12s;">
        <span style="font-size:15px;">${pr.emoji}</span>${t(pr.nameKey)}</button>`
    ).join('');
    p.innerHTML = `
      <div style="display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-bottom:11px;
        padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.10);">
        <span style="font-size:11px;opacity:.7;align-self:center;margin-inline-end:2px;">✨ ${t('styles')}:</span>${presetBtns}
      </div>
      <div style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;justify-content:center;">
        ${sliders}
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <span style="font-size:11px;opacity:.85;">🎨 ${t('bg')}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;max-width:140px;justify-content:center;align-items:center;">${swatches}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:5px;align-self:center;">
          <button id="shimon-card-edit" title="${t('editRealTitle')}"
            style="border:0;border-radius:12px;padding:7px 12px;cursor:pointer;font:700 12px Heebo,sans-serif;
            color:#bfe3ff;background:rgba(80,150,255,.22);white-space:nowrap;">✏️ ${t('editReal')}</button>
          <div style="display:flex;gap:5px;">
            <button id="shimon-style-copy" title="${t('copyStyle')}"
              style="border:0;border-radius:12px;padding:7px 11px;cursor:pointer;font:700 13px Heebo,sans-serif;
              color:#bfe3ff;background:rgba(80,150,255,.18);">📋</button>
            <button id="shimon-style-paste" title="${t('pasteStyle')}"
              style="border:0;border-radius:12px;padding:7px 11px;cursor:pointer;font:700 13px Heebo,sans-serif;
              color:#cbb6ff;background:rgba(160,130,255,.18);">🖌️</button>
            <button id="shimon-card-lock" title="${t('lockCard')}"
              style="border:0;border-radius:12px;padding:7px 11px;cursor:pointer;font:700 13px Heebo,sans-serif;
              color:#ffe0a3;background:rgba(255,180,80,.18);">🔓</button>
            <button id="shimon-style-reset" title="${t('resetCard')}"
              style="border:0;border-radius:12px;padding:7px 11px;cursor:pointer;font:700 13px Heebo,sans-serif;
              color:#ff9e9e;background:rgba(255,107,107,.18);">↺</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(p);
    p.__shimonPanel = true;

    p.querySelectorAll('input[type=range]').forEach(inp => {
      const handler = () => {
        const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
        if (!card) return;
        const k = inp.dataset.k;
        const style = { ...DEFAULT_STYLE, ...(card.__shimonStyle || {}) };
        style[k] = parseFloat(inp.value);
        const f = STYLE_FIELDS.find(x => x.key === k);
        const vEl = p.querySelector(`.val[data-v="${k}"]`);
        if (vEl) vEl.textContent = inp.value + f.unit;
        applyCardStyle(card, normalizeStyle(style));
        save(card.dataset.shimonSlot, currentEntry(card));
      };
      inp.addEventListener('input', handler);
    });
    p.querySelectorAll('button[data-bg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
        if (!card) return;
        const style = { ...DEFAULT_STYLE, ...(card.__shimonStyle || {}) };
        style.bg = BG_SWATCHES[parseInt(btn.dataset.bg)];
        applyCardStyle(card, normalizeStyle(style));
        save(card.dataset.shimonSlot, currentEntry(card));
      });
    });
    // one-tap presets — replace the whole style at once, then resync the sliders
    p.querySelectorAll('button[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
        if (!card) return;
        const preset = PRESETS[parseInt(btn.dataset.preset)].style;
        applyCardStyle(card, normalizeStyle({ ...DEFAULT_STYLE, ...preset }));
        save(card.dataset.shimonSlot, currentEntry(card));
        updateStylePanel();   // reflect the preset's values back into the sliders
      });
    });
    // custom colour → solid background
    const colorInp = p.querySelector('#shimon-bg-color');
    if (colorInp) colorInp.addEventListener('input', () => {
      const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
      if (!card) return;
      const style = { ...DEFAULT_STYLE, ...(card.__shimonStyle || {}) };
      style.bg = colorInp.value;
      applyCardStyle(card, normalizeStyle(style));
      save(card.dataset.shimonSlot, currentEntry(card));
    });
    p.querySelector('#shimon-style-reset').addEventListener('click', () => {
      const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
      if (!card) return;
      applyCardStyle(card, null);
      save(card.dataset.shimonSlot, currentEntry(card));
      updateStylePanel();
      toast(t('toastReset'));
    });
    // 📋 copy this card's whole style to the clipboard (the "format painter")
    p.querySelector('#shimon-style-copy').addEventListener('click', () => {
      const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
      if (!card) return;
      styleClipboard = { ...DEFAULT_STYLE, ...(card.__shimonStyle || {}) };
      updateStylePanel(); updateAlignBar();
      toast(t('toastCopied'));
    });
    // 🖌️ paste the copied style onto the selected card
    p.querySelector('#shimon-style-paste').addEventListener('click', () => pasteStyleToSelection());
    // ✏️ open HA's real native editor for this card
    p.querySelector('#shimon-card-edit').addEventListener('click', () => {
      const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
      openNativeEditor(card);
    });
    // 🔒 lock / unlock this card (locked = stays put, no drag/resize handles)
    p.querySelector('#shimon-card-lock').addEventListener('click', () => {
      const card = (SELECTED.size === 1) ? [...SELECTED][0] : null;
      if (!card) return;
      card.__shimonLocked = !card.__shimonLocked;
      save(card.dataset.shimonSlot, currentEntry(card));
      showHandles(true);                       // refresh handle visibility
      card.style.outline = SEL_OUTLINE; card.style.outlineOffset = '-1px'; // keep selection ring
      updateLockButton(card);
    });
    stylePanel = p;
    return p;
  }

  // reflect a card's lock state in the panel's lock button
  function updateLockButton(card) {
    const b = stylePanel && stylePanel.querySelector('#shimon-card-lock');
    if (!b) return;
    const locked = card && card.__shimonLocked;
    b.textContent = locked ? '🔒' : '🔓';
    b.style.background = locked ? 'rgba(255,180,80,.34)' : 'rgba(255,180,80,.18)';
  }

  // collapse a style object to null if it equals the defaults (keeps storage clean)
  function normalizeStyle(s) {
    if (!s) return null;
    const def = DEFAULT_STYLE;
    const isDefault = s.opacity === def.opacity && !s.blur &&
      (s.radius == null) && !s.shadow && !s.rotate && !s.bg;
    return isDefault ? null : s;
  }

  function updateStylePanel() {
    const p = buildStylePanel();
    if (SELECTED.size !== 1) {
      p.style.opacity = '0'; p.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => { if (SELECTED.size !== 1) p.style.display = 'none'; }, 200);
      return;
    }
    const card = [...SELECTED][0];
    const st = { ...DEFAULT_STYLE, ...(card.__shimonStyle || {}) };
    p.querySelectorAll('input[type=range]').forEach(inp => {
      const f = STYLE_FIELDS.find(x => x.key === inp.dataset.k);
      const v = (st[f.key] == null) ? f.def : st[f.key];
      inp.value = v;
      const vEl = p.querySelector(`.val[data-v="${f.key}"]`);
      if (vEl) vEl.textContent = v + f.unit;
    });
    updateLockButton(card);
    const pasteBtn = p.querySelector('#shimon-style-paste');
    if (pasteBtn) { pasteBtn.style.opacity = styleClipboard ? '1' : '.4'; pasteBtn.style.pointerEvents = styleClipboard ? 'auto' : 'none'; }
    p.style.display = 'block';
    requestAnimationFrame(() => { p.style.opacity = '1'; p.style.transform = 'translateX(-50%) translateY(0)'; });
  }

  // ── align / distribute / z-order toolbar (shown for 2+ selected) ────────────
  let alignBar = null;
  const ALIGN_BTNS = [
    ['left', '⇤', 'alLeft'], ['hcenter', '↔', 'alHC'], ['right', '⇥', 'alRight'],
    ['top', '⤒', 'alTop'], ['vcenter', '↕', 'alVC'], ['bottom', '⤓', 'alBottom'],
    ['hdist', '⇿', 'alHDist'], ['vdist', '⤧', 'alVDist'],
    ['front', '⬆', 'toFront'], ['back', '⬇', 'toBack'],
  ];
  function buildAlignBar() {
    if (alignBar) return alignBar;
    const p = document.createElement('div');
    p.id = 'shimon-align-bar';
    Object.assign(p.style, {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
      zIndex: '2147483600', display: 'none', opacity: '0',
      background: 'linear-gradient(135deg,rgba(28,32,54,.96),rgba(18,20,38,.96))',
      backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
      border: '1px solid rgba(255,255,255,.16)', borderRadius: '18px',
      boxShadow: '0 14px 44px rgba(0,0,0,.55)', padding: '10px 14px',
      color: '#f0f4ff', font: '600 18px/1 Heebo,sans-serif', direction: uiDir(),
      transition: 'opacity .2s ease, transform .2s cubic-bezier(.34,1.4,.6,1)',
      display: 'none',
    });
    p.innerHTML = `<div id="shimon-align-count" style="font-size:12px;opacity:.7;margin-bottom:6px;text-align:center;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center;">` +
      ALIGN_BTNS.map(b => `<button data-a="${b[0]}" title="${t(b[2])}"
        style="width:34px;height:34px;border:0;border-radius:10px;cursor:pointer;font-size:17px;
        color:#dfe6ff;background:rgba(255,255,255,.08);">${b[1]}</button>`).join('') +
      `<button id="shimon-align-paste" title="${t('pasteStyle')}" style="width:34px;height:34px;border:0;border-radius:10px;
        cursor:pointer;font-size:16px;color:#cbb6ff;background:rgba(160,130,255,.18);">🖌️</button>
       <span style="width:1px;height:24px;background:rgba(255,255,255,.18);margin:0 4px;"></span>
       <button id="shimon-align-clear" title="${t('clearSel')}" style="border:0;border-radius:10px;padding:7px 12px;
        cursor:pointer;font:700 12px Heebo;color:#cbb6ff;background:rgba(203,182,255,.16);">✓ ${t('done')}</button></div>`;
    document.body.appendChild(p);
    p.__shimonPanel = true;
    p.querySelectorAll('button[data-a]').forEach(btn => btn.addEventListener('click', () => {
      const a = btn.dataset.a;
      if (a === 'front' || a === 'back') setZ(a);
      else alignSelected(a);
    }));
    p.querySelector('#shimon-align-paste').addEventListener('click', () => pasteStyleToSelection());
    p.querySelector('#shimon-align-clear').addEventListener('click', () => clearSelection());
    alignBar = p;
    return p;
  }
  function updateAlignBar() {
    const p = buildAlignBar();
    if (SELECTED.size < 2) {
      p.style.opacity = '0'; p.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => { if (SELECTED.size < 2) p.style.display = 'none'; }, 200);
      return;
    }
    p.querySelector('#shimon-align-count').textContent = t('nCards', SELECTED.size);
    const pb = p.querySelector('#shimon-align-paste');
    if (pb) { pb.style.opacity = styleClipboard ? '1' : '.4'; pb.style.pointerEvents = styleClipboard ? 'auto' : 'none'; }
    p.style.display = 'block';
    requestAnimationFrame(() => { p.style.opacity = '1'; p.style.transform = 'translateX(-50%) translateY(0)'; });
  }

  // ── scenes: create / switch / delete + the picker bar ──────────────────────
  function switchScene(name) {
    if (!SCENES.includes(name) || name === activeScene) return;
    clearSelection();
    activeScene = name;
    saveMeta();
    reapplyAll();          // re-reads every card from the new scene's keys
    renderScenesBar();
  }
  function createScene() {
    const name = (prompt(t('scenePrompt'), t('sceneDefault', SCENES.length + 1)) || '').trim();
    if (!name || SCENES.includes(name)) return;
    const from = activeScene;
    SCENES.push(name);
    // seed the new scene as a COPY of the current arrangement, so the user
    // tweaks from a familiar starting point rather than a blank board.
    for (const h of HANDLES) {
      const r = localStorage.getItem(prefix() + from + '::' + h.slotId);
      if (r) {
        try {
          localStorage.setItem(prefix() + name + '::' + h.slotId, r);
          Sync.queue(name + '::' + h.slotId, JSON.parse(r));
        } catch {}
      }
    }
    activeScene = name;
    saveMeta();
    renderScenesBar();
  }
  function deleteScene(name) {
    if (SCENES.length <= 1) return;
    if (!confirm(t('deleteSceneQ', name))) return;
    clearScene(name);
    for (const h of HANDLES) Sync.queue(name + '::' + h.slotId, null);
    SCENES = SCENES.filter(s => s !== name);
    if (activeScene === name) { activeScene = SCENES[0]; saveMeta(); reapplyAll(); }
    else saveMeta();
    renderScenesBar();
  }

  let scenesBar = null;
  function renderScenesBar() {
    if (!editing() || !inScope()) { if (scenesBar) scenesBar.style.display = 'none'; return; }
    if (!scenesBar) {
      scenesBar = document.createElement('div');
      scenesBar.id = 'shimon-scenes-bar';
      Object.assign(scenesBar.style, {
        position: 'fixed', top: '96px', left: '18px', zIndex: '2147483550',
        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
        background: 'linear-gradient(135deg,rgba(28,32,54,.94),rgba(18,20,38,.94))',
        backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255,255,255,.14)', borderRadius: '16px',
        boxShadow: '0 8px 26px rgba(0,0,0,.45)', direction: uiDir(),
        font: '700 12px Heebo,sans-serif', flexWrap: 'wrap', maxWidth: '70vw',
      });
      document.body.appendChild(scenesBar);
      scenesBar.__shimonPanel = true;
    }
    scenesBar.style.display = 'flex';
    scenesBar.innerHTML = `<span style="opacity:.6;font-size:11px;margin-inline-end:2px;">🎬 ${t('scenes')}:</span>`;
    for (const s of SCENES) {
      const active = s === activeScene;
      const pill = document.createElement('button');
      pill.textContent = (s === 'ראשי') ? t('sceneMain') : s;
      Object.assign(pill.style, {
        border: '0', borderRadius: '11px', padding: '6px 12px', cursor: 'pointer',
        font: '700 12px Heebo,sans-serif', color: active ? '#fff' : '#cbd4ff',
        background: active ? 'linear-gradient(135deg,#5b8def,#3a52d8)' : 'rgba(255,255,255,.08)',
        boxShadow: active ? '0 2px 8px rgba(58,82,216,.5)' : 'none',
      });
      pill.addEventListener('click', () => switchScene(s));
      scenesBar.appendChild(pill);
    }
    if (SCENES.length > 1) {
      const del = document.createElement('button');
      del.textContent = '🗑';
      del.title = t('delScene');
      Object.assign(del.style, { border: '0', borderRadius: '11px', padding: '6px 9px', cursor: 'pointer',
        background: 'rgba(255,107,107,.16)', color: '#ff9e9e', fontSize: '13px' });
      del.addEventListener('click', () => deleteScene(activeScene));
      scenesBar.appendChild(del);
    }
    const add = document.createElement('button');
    add.textContent = '➕';
    add.title = t('newScene');
    Object.assign(add.style, { border: '0', borderRadius: '11px', padding: '6px 9px', cursor: 'pointer',
      background: 'rgba(120,255,180,.14)', color: '#a8f5c4', fontSize: '13px' });
    add.addEventListener('click', createScene);
    scenesBar.appendChild(add);
  }

  // legacy custom card (renders nothing — button drives everything)
  class ShimonEditBar extends HTMLElement {
    setConfig(c) {
      this._c = c;
      if (this.shadowRoot) return;
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = '<style>:host{display:none!important}</style>';
      this.style.display = 'none';
    }
    set hass(h) { if (h) { Sync.setHass(h); hydrate(); } }
    getCardSize() { return 0; }
    static getStubConfig() { return {}; }
  }
  if (!customElements.get('shimon-edit-bar')) {
    customElements.define('shimon-edit-bar', ShimonEditBar);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: 'shimon-edit-bar', name: 'Shimon Edit Bar', description: '(legacy) freeform toggle' });
  }

  window.shimonFreeformReset   = async () => {
    grabHass();                         // make sure we can reach the server before clearing
    clearStore();
    await Sync.clear();                 // wait for the server wipe to land
    UNDO.length = 0;
    location.reload();
  };
  window.shimonFreeformUndo    = undo;
  window.shimonFreeformRescue  = rescue;
  window.shimonFreeformVersion = VERSION;
  // Cleaner single-namespace API for a public package (the four globals above
  // are kept as back-compat aliases).
  window.shimonFreeform = {
    reset: window.shimonFreeformReset, undo, rescue, version: VERSION,
  };

  console.info(`%c SHIMON-FREEFORM %c ${VERSION} %c Studio Pro breakpoints + style `,
    'background:#5b2a86;color:#fff;padding:2px 8px;border-radius:4px 0 0 4px',
    'background:#26314d;color:#fff;padding:2px 8px',
    'background:#5fb27a;color:#fff;padding:2px 8px;border-radius:0 4px 4px 0');
})();
