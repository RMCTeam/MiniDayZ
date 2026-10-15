/*!
 * MiniDayZ PC Mode
 * ----------------
 * Adds keyboard + mouse support to the Construct 2 browser build of MiniDayZ.
 *
 * MiniDayZ is a mobile-first touch game: movement is done with an on-screen
 * stick / tap-draw control, and everything else is done by tapping the HUD.
 * This overlay translates keyboard and mouse input into the same pointer
 * events the game already understands, so no game data has to be modified.
 *
 * Controls (all remappable through window.PCMODE_CONFIG, see below):
 *   W A S D / Arrow keys ......... move (virtual stick)
 *   Left mouse button ............ move toward the cursor (draw style)
 *   Space / J .................... attack / use in the current facing direction
 *   F ............................ interact / pick up at your feet
 *   E ............................ inventory (tap the bag button)
 *   R ............................ reload (tap the reload button)
 *   Esc .......................... game menu / pause
 *   Tab, C, I, M ................. inventory / crafting / map shortcuts
 *   H ............................ toggle this help
 *   F1 ........................... enable / disable PC mode
 *
 * Everything is best-effort: if your build lays the HUD out differently you
 * can fine-tune it from the browser console, e.g.
 *     PCMODE_CONFIG.tapAt = { inventory: [0.93, 0.08] };
 *
 * The script is inert until the game canvas exists and never throws into the
 * page: every entry point is wrapped.
 */
(function () {
	'use strict';

	if (window.__MNDZ_PCMODE__) return;
	window.__MNDZ_PCMODE__ = true;

	/* ------------------------------------------------------------------ *
	 * Configuration
	 * ------------------------------------------------------------------ */
	var defaults = {
		enabled: true,            // start with PC mode active
		virtualStick: true,       // WASD drives a virtual on-screen stick
		followMouse: true,        // holding LMB walks toward the cursor
		stickRadius: 0.16,        // stick throw, as a fraction of the short axis
		deadZone: 0.18,           // ignore tiny movement
		emitKeyboard: false,      // also forward real key events (native WASD mode)
		showHelpOnStart: 6,       // seconds to show the help card on load (0 = never)
		// Keys use KeyboardEvent.code so they work on any layout.
		keys: {
			up:    ['KeyW', 'ArrowUp'],
			down:  ['KeyS', 'ArrowDown'],
			left:  ['KeyA', 'ArrowLeft'],
			right: ['KeyD', 'ArrowRight'],
			attack: ['Space', 'KeyJ'],
			interact: ['KeyF'],
			inventory: ['KeyE', 'KeyI', 'Tab'],
			reload: ['KeyR'],
			map: ['KeyM'],
			craft: ['KeyC'],
			menu: ['Escape'],
			help: ['KeyH'],
			toggle: ['F1']
		},
		// Normalised (0..1 of the canvas) screen points that are tapped for the
		// non-movement shortcuts. Tuned for the 1024x768 HUD of MiniDayZ Plus.
		tapAt: {
			inventory: [0.92, 0.10],
			reload:    [0.95, 0.46],
			map:       [0.97, 0.24],
			craft:     [0.97, 0.60],
			menu:      [0.02, 0.03]
		}
	};

	var cfg = (function merge(dst, src) {
		if (!src) return dst;
		for (var k in src) {
			if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
			if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) &&
				dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
				merge(dst[k], src[k]);
			} else {
				dst[k] = src[k];
			}
		}
		return dst;
	})(defaults, window.PCMODE_CONFIG);
	window.PCMODE_CONFIG = cfg;
	window.PCMODE = { config: cfg, enabled: cfg.enabled };

	/* ------------------------------------------------------------------ *
	 * Helpers
	 * ------------------------------------------------------------------ */
	function canvas() {
		return document.getElementById('c2canvas') || document.querySelector('canvas');
	}

	function isTypingTarget(el) {
		if (!el) return false;
		var t = (el.tagName || '').toLowerCase();
		return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
	}

	function isDown(code) {
		for (var name in cfg.keys) {
			if (cfg.keys[name].indexOf(code) >= 0) return true;
		}
		return false;
	}

	function axis(code) {
		var k = cfg.keys;
		if (k.up.indexOf(code) >= 0) return [0, -1];
		if (k.down.indexOf(code) >= 0) return [0, 1];
		if (k.left.indexOf(code) >= 0) return [-1, 0];
		if (k.right.indexOf(code) >= 0) return [1, 0];
		return null;
	}

	/* ------------------------------------------------------------------ *
	 * Pointer synthesis
	 *
	 * The engine listens for pointer / mouse / touch events. We build one of
	 * each for every interaction so every code path the game uses is fed.
	 * ------------------------------------------------------------------ */
	function makeTouch(c, x, y) {
		try {
			return new Touch({ identifier: 1, target: c, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
		} catch (e) { return null; }
	}

	function dispatch(type, x, y) {
		var c = canvas();
		if (!c) return;
		var base = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
			button: 0, buttons: type === 'up' || type === 'move' ? 1 : 1,
			pointerId: 1, pointerType: 'mouse', isPrimary: true, detail: 1
		};
		var isDown = (type === 'down');

		// 1) Pointer events (preferred by modern Construct 2 runtimes).
		if (window.PointerEvent) {
			try {
				var ptype = type === 'down' ? 'pointerdown' : type === 'up' ? 'pointerup' : 'pointermove';
				c.dispatchEvent(new PointerEvent(ptype, base));
			} catch (e) {}
		}

		// 2) Mouse events (used by the Mouse plugin on desktop browsers).
		try {
			var mtype = isDown ? 'mousedown' : type === 'up' ? 'mouseup' : 'mousemove';
			var me = new MouseEvent(mtype, base);
			c.dispatchEvent(me);
			document.dispatchEvent(new MouseEvent(mtype, base));
		} catch (e) {}

		// 3) Touch events (used by the Touch plugin on touch-first builds).
		try {
			if (window.TouchEvent) {
				var touch = makeTouch(c, x, y);
				var ttype = isDown ? 'touchstart' : type === 'up' ? 'touchend' : 'touchmove';
				var list = (type === 'up') ? [] : [touch];
				var te = new TouchEvent(ttype, {
					bubbles: true, cancelable: true, composed: true, view: window,
					touches: (type === 'up' ? [] : list),
					targetTouches: list,
					changedTouches: [touch]
				});
				c.dispatchEvent(te);
				document.dispatchEvent(te);
			}
		} catch (e) {}
	}

	/* ------------------------------------------------------------------ *
	 * Geometry
	 * ------------------------------------------------------------------ */
	function rect() {
		var c = canvas();
		return c ? c.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
	}

	function toClient(fx, fy) {
		var r = rect();
		return [r.left + fx * r.width, r.top + fy * r.height];
	}

	function center() {
		var r = rect();
		return [r.left + r.width / 2, r.top + r.height / 2];
	}

	function stickThrow() {
		var r = rect();
		return Math.min(r.width, r.height) * cfg.stickRadius;
	}

	/* ------------------------------------------------------------------ *
	 * Movement state
	 * ------------------------------------------------------------------ */
	var down = false;      // a pointer is currently held by PC mode
	var mode = null;       // 'stick' | 'mouse'
	var pressed = Object.create(null);

	function vector() {
		var vx = 0, vy = 0;
		for (var code in pressed) {
			if (!pressed[code]) continue;
			var a = axis(code);
			if (a) { vx += a[0]; vy += a[1]; }
		}
		var len = Math.hypot(vx, vy);
		if (len < 0.001) return null;
		return [vx / len, vy / len];
	}

	function press(x, y, source) {
		dispatch('down', x, y);
		down = true;
		mode = source;
	}

	function move(x, y) {
		if (!down) return;
		dispatch('move', x, y);
	}

	function release(x, y) {
		if (!down) return;
		dispatch('up', x, y);
		down = false;
		mode = null;
	}

	/* ------------------------------------------------------------------ *
	 * Frame update
	 * ------------------------------------------------------------------ */
	function tick() {
		try {
			if (cfg.enabled) {
				var v = vector();
				var c = center();
				if (v) {
					var t = stickThrow();
					move(c[0] + v[0] * t, c[1] + v[1] * t);
					if (!down) press(c[0], c[1], 'stick');
				} else if (mode === 'stick') {
					release(c[0], c[1]);
				}
			}
		} catch (e) {}
		requestAnimationFrame(tick);
	}

	/* ------------------------------------------------------------------ *
	 * Keyboard
	 * ------------------------------------------------------------------ */
	function onKeyDown(e) {
		if (isTypingTarget(e.target)) return;
		if (cfg.keys.toggle.indexOf(e.code) >= 0) { toggle(); e.preventDefault(); return; }
		if (!cfg.enabled) return;

		if (cfg.keys.help.indexOf(e.code) >= 0) { toggleHelp(); e.preventDefault(); return; }

		if (isDown(e.code) || axis(e.code)) {
			pressed[e.code] = true;
			e.preventDefault();          // stop the page from scrolling
		}

		// Single-shot shortcuts -> tap a HUD point.
		var k = cfg.keys;
		if (k.attack.indexOf(e.code) >= 0) { tapFacing(); e.preventDefault(); }
		if (k.interact.indexOf(e.code) >= 0) { tapAt('interact', 0.5, 0.5); e.preventDefault(); }
		if (k.inventory.indexOf(e.code) >= 0) { tapPoint(cfg.tapAt.inventory); e.preventDefault(); }
		if (k.reload.indexOf(e.code) >= 0) { tapPoint(cfg.tapAt.reload); e.preventDefault(); }
		if (k.map.indexOf(e.code) >= 0) { tapPoint(cfg.tapAt.map); e.preventDefault(); }
		if (k.craft.indexOf(e.code) >= 0) { tapPoint(cfg.tapAt.craft); e.preventDefault(); }
		if (k.menu.indexOf(e.code) >= 0) { tapPoint(cfg.tapAt.menu); e.preventDefault(); }

		if (cfg.emitKeyboard) {
			try {
				document.dispatchEvent(new KeyboardEvent('keydown', {
					bubbles: true, cancelable: true, code: e.code, key: e.key, keyCode: e.keyCode, which: e.which
				}));
			} catch (err) {}
		}
	}

	function onKeyUp(e) {
		if (pressed[e.code]) { delete pressed[e.code]; e.preventDefault(); }
	}

	/* ------------------------------------------------------------------ *
	 * Mouse
	 * ------------------------------------------------------------------ */
	var mouseWatch = null;
	var mouseClient = null;

	function onMouseMove(e) { mouseClient = [e.clientX, e.clientY]; }

	function onMouseDown(e) {
		if (!cfg.enabled || !cfg.followMouse || e.button !== 0) return;
		// Ignore clicks on our own help card / when a DOM UI is focused.
		if (e.target && e.target.closest && e.target.closest('#pcmode-help')) return;
		// Let the game handle genuine HUD taps natively; only start a walk
		// when the player is not clicking a UI element (i.e. the play field).
		if (!isTypingTarget(e.target)) {
			// Start following after a tiny delay so a plain click still registers
			// with the game as a normal tap.
			clearTimeout(mouseWatch);
			mouseWatch = setTimeout(function () { if (mouseClient) press(mouseClient[0], mouseClient[1], 'mouse'); }, 120);
		}
	}

	function onMouseUp(e) {
		if (e.button !== 0) return;
		clearTimeout(mouseWatch);
		if (mode === 'mouse') release(e.clientX, e.clientY);
	}

	function onCtx(e) { if (cfg.enabled) e.preventDefault(); }

	/* ------------------------------------------------------------------ *
	 * Shortcut taps
	 * ------------------------------------------------------------------ */
	function tapAt(name, fx, fy) {
		var p = toClient(fx, fy);
		dispatch('down', p[0], p[1]);
		setTimeout(function () { dispatch('up', p[0], p[1]); }, 40);
	}

	function tapPoint(pt) {
		if (!pt) return;
		tapAt('', pt[0], pt[1]);
	}

	// Attack / use in the facing direction: press slightly in front of the player.
	function tapFacing() {
		var c = center();
		var t = stickThrow() * 0.9;
		var v = vector() || lastDir || [0, -1];
		dispatch('down', c[0] + v[0] * t, c[1] + v[1] * t);
		setTimeout(function () { dispatch('up', c[0] + v[0] * t, c[1] + v[1] * t); }, 60);
	}

	var lastDir = [0, -1];

	/* ------------------------------------------------------------------ *
	 * Help card
	 * ------------------------------------------------------------------ */
	var helpEl = null, helpTimer = null;

	function buildHelp() {
		var el = document.createElement('div');
		el.id = 'pcmode-help';
		el.innerHTML =
			'<b>PC Mode</b> <span>(H to hide &middot; F1 to toggle)</span>' +
			'<table>' +
			'<tr><td>W A S D / Arrows</td><td>move</td></tr>' +
			'<tr><td>Hold left mouse</td><td>walk toward cursor</td></tr>' +
			'<tr><td>Space / J</td><td>attack / use</td></tr>' +
			'<tr><td>F</td><td>interact</td></tr>' +
			'<tr><td>E / I / Tab</td><td>inventory</td></tr>' +
			'<tr><td>R</td><td>reload</td></tr>' +
			'<tr><td>M / C</td><td>map / craft</td></tr>' +
			'<tr><td>Esc</td><td>menu</td></tr>' +
			'</table>' +
			'<div class="hint">If movement feels off, set the game\'s control mode to <b>By tap</b> in Settings.</div>';
		document.body.appendChild(el);
		return el;
	}

	function toggleHelp(force) {
		if (!helpEl) helpEl = buildHelp();
		var show = (typeof force === 'boolean') ? force : helpEl.classList.contains('hidden');
		helpEl.classList.toggle('hidden', !show);
		clearTimeout(helpTimer);
		if (show && cfg.showHelpOnStart) helpTimer = setTimeout(function () { toggleHelp(false); }, cfg.showHelpOnStart * 1000);
	}

	function toggle() {
		cfg.enabled = !cfg.enabled;
		window.PCMODE.enabled = cfg.enabled;
		if (!cfg.enabled) {
			release.apply(null, center());
			document.getElementById('pcmode-badge').classList.add('off');
		} else {
			document.getElementById('pcmode-badge').classList.remove('off');
		}
	}

	function buildBadge() {
		var b = document.createElement('div');
		b.id = 'pcmode-badge';
		b.textContent = 'PC';
		b.title = 'PC Mode active (F1 to toggle)';
		document.body.appendChild(b);
		return b;
	}

	/* ------------------------------------------------------------------ *
	 * Styles
	 * ------------------------------------------------------------------ */
	function injectStyles() {
		if (document.getElementById('pcmode-styles')) return;
		var s = document.createElement('style');
		s.id = 'pcmode-styles';
		s.textContent = [
			'#pcmode-badge{position:fixed;right:6px;bottom:6px;z-index:2147483000;',
			'font:11px/1.4 monospace;color:#8fe88f;background:rgba(0,0,0,.45);',
			'padding:2px 6px;border-radius:4px;pointer-events:none;opacity:.8}',
			'#pcmode-badge.off{color:#888}',
			'#pcmode-help{position:fixed;left:12px;top:12px;z-index:2147483001;',
			'background:rgba(10,6,6,.86);color:#e8dede;border:1px solid #4a2020;',
			'border-radius:8px;padding:10px 14px;font:12px/1.5 monospace;',
			'max-width:340px;box-shadow:0 6px 24px rgba(0,0,0,.5)}',
			'#pcmode-help.hidden{display:none}',
			'#pcmode-help b{color:#ff6b6b;font-size:13px}',
			'#pcmode-help span{color:#9a8a8a;font-size:11px}',
			'#pcmode-help table{border-collapse:collapse;margin-top:6px}',
			'#pcmode-help td{padding:1px 8px 1px 0;vertical-align:top}',
			'#pcmode-help td:first-child{color:#ffd27f;white-space:nowrap}',
			'#pcmode-help .hint{margin-top:8px;color:#9a8a8a;font-size:11px}'
		].join('');
		document.head.appendChild(s);
	}

	/* ------------------------------------------------------------------ *
	 * Boot
	 * ------------------------------------------------------------------ */
	function boot() {
		if (!canvas()) { setTimeout(boot, 200); return; }
		injectStyles();
		buildBadge();
		helpEl = buildHelp();
		toggleHelp(cfg.showHelpOnStart > 0);

		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('keyup', onKeyUp, true);
		window.addEventListener('blur', function () { pressed = Object.create(null); var c = center(); release(c[0], c[1]); });
		canvas().addEventListener('contextmenu', onCtx);
		document.addEventListener('mousemove', onMouseMove, true);
		document.addEventListener('mousedown', onMouseDown, true);
		document.addEventListener('mouseup', onMouseUp, true);

		// Track last facing so Space attacks where you're heading.
		window.addEventListener('keydown', function () {
			var v = vector(); if (v) lastDir = v;
		}, true);

		requestAnimationFrame(tick);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
