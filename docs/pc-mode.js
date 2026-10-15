/*!
 * MiniDayZ PC Mode
 * ----------------
 * Adds keyboard + mouse support to the Construct 2 browser build of MiniDayZ.
 *
 * MiniDayZ is a mobile-first touch game: movement is done with an on-screen
 * stick / tap-draw control, and everything else is done by tapping the HUD.
 * This overlay translates keyboard input into the same pointer events the
 * game already understands, so no game data has to be modified.
 *
 * How it works:
 *  - Movement (WASD/arrows) holds a virtual pointer down at the screen
 *    centre and drags it toward the pressed direction, exactly like
 *    pressing and dragging on a touchscreen.
 *  - Shortcut keys (attack, inventory, ...) tap the game's own HUD buttons.
 *    Button positions are NOT hard-coded: they are discovered live from the
 *    running engine (object types t497/t505/t509/t512/t522/...) and converted
 *    to screen pixels with the engine's own layer transform, so they stay
 *    correct on any window size or aspect ratio.
 *  - Real mouse input is never intercepted or re-dispatched; the game
 *    receives genuine clicks exactly once. Synthetic overlay events are
 *    tagged and ignored by our own listeners, so no feedback loops are
 *    possible (this previously caused "too much recursion" crashes and
 *    double-pressed buttons).
 *
 * Controls (remappable through window.PCMODE_CONFIG, persisted to
 * localStorage under 'mndz-pcmode-v1'):
 *   W A S D / Arrow keys ......... move (virtual stick, gameplay only)
 *   Space / J .................... attack (falls back to interact unarmed)
 *   F ............................ interact / pick up
 *   E / I / Tab .................. inventory
 *   R ............................ reload (when a firearm is equipped)
 *   Q ............................ switch weapon
 *   F1 ........................... enable / disable PC Mode
 *   F2 ........................... open PC settings
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
	var STORE_KEY = 'mndz-pcmode-v1';
	var SYNTH = '__mndzSynth';

	var defaults = {
		enabled: true,            // start with PC mode active
		virtualStick: true,       // WASD drives a virtual on-screen stick
		stickRadius: 0.16,        // stick throw, as a fraction of the short axis
		moveTickMs: 50,           // minimum gap between synthesised moves
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
			weapon: ['KeyQ'],
			help: [],             // (unbound; use the ? button / F2 panel)
			settings: ['F2'],
			toggle: ['F1']
		}
	};

	function merge(dst, src) {
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
	}

	var cfg = merge(defaults, window.PCMODE_CONFIG);
	try {
		var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
		if (saved) merge(cfg, saved);
	} catch (e) {}
	window.PCMODE_CONFIG = cfg;

	function persist() {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify({
				enabled: cfg.enabled,
				virtualStick: cfg.virtualStick,
				stickRadius: cfg.stickRadius
			}));
		} catch (e) {}
	}

	/* ------------------------------------------------------------------ *
	 * Helpers
	 * ------------------------------------------------------------------ */
	function canvas() {
		return document.getElementById('c2canvas') || document.querySelector('canvas');
	}

	function runtime() {
		try { return window.cr_getC2Runtime() || null; } catch (e) { return null; }
	}

	function isTypingTarget(el) {
		if (!el) return false;
		var t = (el.tagName || '').toLowerCase();
		return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
	}

	// Only genuine user input may drive the overlay. Anything we synthesise
	// ourselves (isTrusted === false, or explicitly tagged) is ignored so a
	// synthetic event can never re-enter our handlers (infinite recursion).
	function isReal(e) {
		try {
			if (e && e[SYNTH]) return false;
			if (e && typeof e.isTrusted === 'boolean' && !e.isTrusted) return false;
		} catch (err) {}
		return true;
	}

	function markSynthetic(e) {
		try { e[SYNTH] = true; } catch (err) {}
		return e;
	}

	function inList(list, code) {
		return list && list.indexOf(code) >= 0;
	}

	function axis(code) {
		var k = cfg.keys;
		if (inList(k.up, code)) return [0, -1];
		if (inList(k.down, code)) return [0, 1];
		if (inList(k.left, code)) return [-1, 0];
		if (inList(k.right, code)) return [1, 0];
		return null;
	}

	var GAMEPLAY = { Map: true, Polygon: true, Tutorial: true };

	function layoutName() {
		try {
			var rt = runtime();
			return (rt && rt.wa && rt.wa.name) || '';
		} catch (e) { return ''; }
	}

	function inGame() {
		var n = layoutName();
		if (GAMEPLAY[n]) return true;
		// Fallback: a HUD button is on screen (covers present/future layouts).
		try { return Object.keys(scanButtons()).length > 0; } catch (e) { return false; }
	}

	/* ------------------------------------------------------------------ *
	 * Pointer synthesis — dispatched on the canvas ONLY (it bubbles to
	 * document, where the engine listens). Dispatching a second copy on
	 * document double-triggers every button (toggles flip twice and look
	 * broken). One logical press == one PointerEvent + one MouseEvent +
	 * one TouchEvent, mirroring a real mobile tap.
	 * ------------------------------------------------------------------ */
	function makeTouch(c, x, y) {
		try {
			return new Touch({
				identifier: 1, target: c,
				clientX: x, clientY: y, pageX: x, pageY: y,
				screenX: x, screenY: y
			});
		} catch (e) { return null; }
	}

	function dispatch(type, x, y) {
		var c = canvas();
		if (!c) return;
		var down = (type === 'down');
		var base = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: x, clientY: y, pageX: x, pageY: y,
			screenX: x, screenY: y,
			button: 0, buttons: down || type === 'move' ? 1 : 0,
			pointerId: 1, pointerType: 'touch', isPrimary: true, detail: 1
		};
		if (window.PointerEvent) {
			try {
				var ptype = down ? 'pointerdown' : type === 'up' ? 'pointerup' : 'pointermove';
				c.dispatchEvent(markSynthetic(new PointerEvent(ptype, base)));
			} catch (e) {}
		}
		try {
			var mtype = down ? 'mousedown' : type === 'up' ? 'mouseup' : 'mousemove';
			c.dispatchEvent(markSynthetic(new MouseEvent(mtype, base)));
		} catch (e) {}
		try {
			if (window.TouchEvent) {
				var touch = makeTouch(c, x, y);
				if (touch) {
					var ttype = down ? 'touchstart' : type === 'up' ? 'touchend' : 'touchmove';
					var live = (type === 'up') ? [] : [touch];
					c.dispatchEvent(markSynthetic(new TouchEvent(ttype, {
						bubbles: true, cancelable: true, composed: true, view: window,
						touches: live, targetTouches: live, changedTouches: [touch]
					})));
				}
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

	function center() {
		var r = rect();
		return [r.left + r.width / 2, r.top + r.height / 2];
	}

	function stickThrow() {
		var r = rect();
		return Math.min(r.width, r.height) * cfg.stickRadius;
	}

	/* ------------------------------------------------------------------ *
	 * Live HUD-button calibration.
	 *
	 * Button object types (stable ids in this build, found via the HUD art):
	 *   t497 inventory | t505 attack | t509 switch weapon | t512 interact
	 *   t522 reload    | t288 help   | t602 perks        | t712 friend
	 * Positions are read from LIVE instances every time (the game parks and
	 * re-anchors them per aspect/state; authored data.js coordinates are
	 * NOT used) and converted with the engine's own layer transform, so
	 * taps are exact on any window size.
	 * ------------------------------------------------------------------ */
	var BUTTON_TYPES = {
		t497: 'inventory', t505: 'attack', t509: 'switch', t512: 'interact',
		t522: 'reload', t288: 'help', t602: 'perks', t712: 'friend'
	};
	var HUD_LAYERS = {
		GUI_controls: true, GUI: true, GUI_elements: true,
		GUI_overs: true, GUI_drag: true, Gui_counters: true
	};

	function scanButtons() {
		var found = {};
		var rt = runtime();
		if (!rt || !rt.wa || !rt.wa.ua) return found;
		var r = rect();
		var layers = rt.wa.ua;
		for (var i = 0; i < layers.length; i++) {
			var ly = layers[i];
			if (!ly || !HUD_LAYERS[ly.name] || !ly.q) continue;
			if (typeof ly.Ra !== 'function') continue;
			for (var j = 0; j < ly.q.length; j++) {
				var inst = ly.q[j];
				var tname = '';
				try { tname = inst.type.name; } catch (e) { continue; }
				var action = BUTTON_TYPES[tname];
				if (!action || found[action]) continue;
				var vis = true;
				try { vis = !!inst.visible; } catch (e) {}
				if (!vis) continue;
				var w = +inst.width || 0, h = +inst.height || 0;
				if (w < 10 || h < 10) continue;   // collapsed/hidden placeholder
				var mc = (+inst.Mc === +inst.Mc) ? +inst.Mc : 0.5;
				var nc = (+inst.Nc === +inst.Nc) ? +inst.Nc : 0.5;
				var bx = (+inst.x) + (0.5 - mc) * w;
				var by = (+inst.y) + (0.5 - nc) * h;
				if (!(bx === bx && by === by)) continue;
				var cx, cy;
				try {
					cx = r.left + ly.Ra(bx, by, true, false);
					cy = r.top + ly.Ra(bx, by, false, false);
				} catch (e) { continue; }
				if (!(cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height)) continue;
				found[action] = [cx, cy];
			}
		}
		return found;
	}

	function tapButton(action, fallback) {
		if (!cfg.enabled || !inGame()) return false;
	 var pts;
		try { pts = scanButtons(); } catch (e) { return false; }
		var p = pts[action] || (fallback ? pts[fallback] : null);
		if (!p) return false;
		dispatch('down', p[0], p[1]);
		setTimeout(function () { dispatch('up', p[0], p[1]); }, 60);
		return true;
	}

	/* ------------------------------------------------------------------ *
	 * Movement state (virtual stick)
	 * ------------------------------------------------------------------ */
	var down = false;
	var lastMoveSent = 0;
	var lastMovePos = null;
	var pressed = Object.create(null);
	var lastDir = [0, -1];
	var lastLayout = '';

	function vector() {
		var vx = 0, vy = 0;
		for (var code in pressed) {
			if (!pressed[code]) continue;
			var a = axis(code);
			if (a) { vx += a[0]; vy += a[1]; }
		}
		var len = Math.sqrt(vx * vx + vy * vy);
		if (len < 0.001) return null;
		return [vx / len, vy / len];
	}

	function press(x, y) {
		down = true;
		lastMoveSent = 0;
		lastMovePos = null;
		dispatch('down', x, y);
	}

	function moveTo(x, y) {
		if (!down) return;
		var now = Date.now();
		if (lastMovePos) {
			var dx = x - lastMovePos[0], dy = y - lastMovePos[1];
			if (dx * dx + dy * dy < 4 && now - lastMoveSent < cfg.moveTickMs) return;
		}
		lastMoveSent = now;
		lastMovePos = [x, y];
		dispatch('move', x, y);
	}

	function release(x, y) {
		if (!down) return;
		down = false;
		lastMovePos = null;
		dispatch('up', x, y);
	}

	function tick() {
		try {
			var n = layoutName();
			if (n !== lastLayout) {
				lastLayout = n;
				if (down) { down = false; lastMovePos = null; }
			}
			if (cfg.enabled && cfg.virtualStick && inGame()) {
				var v = vector();
				var c = center();
				if (v) {
					lastDir = v;
					var t = stickThrow();
					if (!down) press(c[0], c[1]);
					moveTo(c[0] + v[0] * t, c[1] + v[1] * t);
				} else if (down) {
					release(c[0], c[1]);
				}
			} else if (down) {
				var c2 = center();
				release(c2[0], c2[1]);
			}
		} catch (e) {}
		requestAnimationFrame(tick);
	}

	/* ------------------------------------------------------------------ *
	 * Keyboard
	 * ------------------------------------------------------------------ */
	function onKeyDown(e) {
		if (!isReal(e)) return;
		if (isTypingTarget(e.target)) return;
		if (inList(cfg.keys.toggle, e.code)) { toggleEnabled(); e.preventDefault(); return; }
		if (inList(cfg.keys.settings, e.code)) { toggleSettings(); e.preventDefault(); return; }
		if (!cfg.enabled) return;

		if (axis(e.code)) {
			pressed[e.code] = true;
			e.preventDefault();          // stop the page from scrolling
			return;
		}

		if (e.repeat) return;            // single-shot shortcuts fire once
		var k = cfg.keys;
		if (inList(k.attack, e.code)) {
			// Unarmed there is no attack button: interact (pick up) instead.
			if (!tapButton('attack')) tapButton('interact');
			e.preventDefault();
		} else if (inList(k.interact, e.code)) {
			tapButton('interact'); e.preventDefault();
		} else if (inList(k.inventory, e.code)) {
			tapButton('inventory'); e.preventDefault();
		} else if (inList(k.reload, e.code)) {
			tapButton('reload'); e.preventDefault();
		} else if (inList(k.weapon, e.code)) {
			tapButton('switch'); e.preventDefault();
		}
		// NOTE: Esc / M / game menus are intentionally NOT synthesised: no
		// reliable pause/map button exists to tap, and the engine already
		// receives these keys natively (preventDefault never blocks the
		// game's own listeners).
	}

	function onKeyUp(e) {
		if (!isReal(e)) return;
		if (pressed[e.code]) { delete pressed[e.code]; e.preventDefault(); }
	}

	function onBlur() {
		pressed = Object.create(null);
		if (down) {
			down = false;
			lastMovePos = null;
			var c = center();
			dispatch('up', c[0], c[1]);
		}
	}

	function onCtx(e) { if (cfg.enabled) e.preventDefault(); }

	/* ------------------------------------------------------------------ *
	 * Help card + settings panel (DOM only; never intercept game clicks:
	 * the card is pointer-transparent, the panel only when open)
	 * ------------------------------------------------------------------ */
	var helpEl = null, helpTimer = null;
	var settingsEl = null;

	function buildHelp() {
		var el = document.createElement('div');
		el.id = 'pcmode-help';
		el.className = 'hidden';
		el.innerHTML =
			'<b>PC Mode</b> <span>(F1 on/off &middot; F2 settings)</span>' +
			'<table>' +
			'<tr><td>W A S D / Arrows</td><td>move</td></tr>' +
			'<tr><td>Space / J</td><td>attack (interact unarmed)</td></tr>' +
			'<tr><td>F</td><td>interact / pick up</td></tr>' +
			'<tr><td>E / I / Tab</td><td>inventory</td></tr>' +
			'<tr><td>R</td><td>reload</td></tr>' +
			'<tr><td>Q</td><td>switch weapon</td></tr>' +
			'<tr><td>Mouse</td><td>works natively, click directly</td></tr>' +
			'</table>' +
			'<div class="hint">Tip: set the game control mode to <b>By tap</b> in Settings for the smoothest feel.</div>';
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

	function diagButtons() {
		var pts;
		try { pts = scanButtons(); } catch (e) { pts = {}; }
		var names = Object.keys(pts);
		if (!names.length) return 'no HUD buttons visible (open gameplay first)';
		return names.sort().map(function (a) {
			return a + ' @ ' + Math.round(pts[a][0]) + ',' + Math.round(pts[a][1]);
		}).join('<br>');
	}

	function buildSettings() {
		var el = document.createElement('div');
		el.id = 'pcmode-settings';
		el.className = 'hidden';
		el.innerHTML =
			'<b>PC Mode settings</b> <span>(F2 to close)</span>' +
			'<label><input type="checkbox" id="pcs-enabled"> enabled (F1)</label>' +
			'<label><input type="checkbox" id="pcs-stick"> WASD virtual stick</label>' +
			'<label>stick reach <input type="range" id="pcs-radius" min="0.08" max="0.30" step="0.01"></label>' +
			'<div class="row"><button id="pcs-help">controls help</button>' +
			'<button id="pcs-cal">re-check buttons</button></div>' +
			'<div class="diag" id="pcs-diag"></div>' +
			'<div class="hint">In-game options (sound, stick position, language) live in the game\u2019s own ' +
			'menu: main menu &gt; Options, or the pause panel. PC Mode does not replace them.</div>';
		document.body.appendChild(el);
		el.querySelector('#pcs-enabled').addEventListener('change', function (ev) {
			cfg.enabled = ev.target.checked;
			if (!cfg.enabled && down) {
				down = false;
				lastMovePos = null;
				var c = center();
				dispatch('up', c[0], c[1]);
			}
			persist(); syncBadge();
		});
		el.querySelector('#pcs-stick').addEventListener('change', function (ev) {
			cfg.virtualStick = ev.target.checked; persist();
		});
		el.querySelector('#pcs-radius').addEventListener('input', function (ev) {
			cfg.stickRadius = parseFloat(ev.target.value) || cfg.stickRadius; persist();
		});
		el.querySelector('#pcs-help').addEventListener('click', function () { toggleHelp(true); });
		el.querySelector('#pcs-cal').addEventListener('click', function () {
			el.querySelector('#pcs-diag').innerHTML = diagButtons();
		});
		return el;
	}

	function toggleSettings(force) {
		if (!settingsEl) settingsEl = buildSettings();
		var show = (typeof force === 'boolean') ? force : settingsEl.classList.contains('hidden');
		settingsEl.querySelector('#pcs-enabled').checked = !!cfg.enabled;
		settingsEl.querySelector('#pcs-stick').checked = !!cfg.virtualStick;
		settingsEl.querySelector('#pcs-radius').value = cfg.stickRadius;
		if (show) settingsEl.querySelector('#pcs-diag').innerHTML = diagButtons();
		settingsEl.classList.toggle('hidden', !show);
	}

	function toggleEnabled() {
		cfg.enabled = !cfg.enabled;
		if (!cfg.enabled && down) {
			down = false;
			lastMovePos = null;
			var c = center();
			dispatch('up', c[0], c[1]);
		}
		persist(); syncBadge();
	}

	function syncBadge() {
		var b = document.getElementById('pcmode-badge');
		if (b) b.classList.toggle('off', !cfg.enabled);
	}

	function buildBadge() {
		var b = document.createElement('div');
		b.id = 'pcmode-badge';
		b.textContent = 'PC';
		b.title = 'PC Mode (F1 on/off, F2 settings)';
		document.body.appendChild(b);
		syncBadge();
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
			'max-width:340px;box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:none}',
			'#pcmode-help.hidden{display:none}',
			'#pcmode-help b{color:#ff6b6b;font-size:13px}',
			'#pcmode-help span{color:#9a8a8a;font-size:11px}',
			'#pcmode-help table{border-collapse:collapse;margin-top:6px}',
			'#pcmode-help td{padding:1px 8px 1px 0;vertical-align:top}',
			'#pcmode-help td:first-child{color:#ffd27f;white-space:nowrap}',
			'#pcmode-help .hint{margin-top:8px;color:#9a8a8a;font-size:11px}',
			'#pcmode-settings{position:fixed;left:12px;top:12px;z-index:2147483002;',
			'background:rgba(10,6,6,.94);color:#e8dede;border:1px solid #4a2020;',
			'border-radius:8px;padding:10px 14px;font:12px/1.5 monospace;',
			'max-width:360px;box-shadow:0 6px 24px rgba(0,0,0,.6)}',
			'#pcmode-settings.hidden{display:none}',
			'#pcmode-settings b{color:#ff6b6b;font-size:13px}',
			'#pcmode-settings span{color:#9a8a8a;font-size:11px}',
			'#pcmode-settings label{display:block;margin-top:6px}',
			'#pcmode-settings .row{margin-top:8px}',
			'#pcmode-settings button{font:12px monospace;margin-right:6px}',
			'#pcmode-settings .diag{margin-top:8px;color:#ffd27f;font-size:11px}',
			'#pcmode-settings .hint{margin-top:8px;color:#9a8a8a;font-size:11px}'
		].join('');
		document.head.appendChild(s);
	}

	/* ------------------------------------------------------------------ *
	 * Public API (used by tests / console tuning)
	 * ------------------------------------------------------------------ */
	window.PCMODE = {
		config: cfg,
		get enabled() { return cfg.enabled; },
		tap: tapButton,
		buttons: scanButtons,
		settings: function () { toggleSettings(true); },
		help: function () { toggleHelp(true); },
		layout: layoutName
	};

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
		window.addEventListener('blur', onBlur);
		canvas().addEventListener('contextmenu', onCtx);
		// NOTE: no mouse listeners on purpose — genuine mouse input reaches
		// the game untouched, exactly once. Only the keyboard is synthesised.

		window.addEventListener('keydown', function (e) {
			if (!isReal(e) || isTypingTarget(e.target)) return;
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
