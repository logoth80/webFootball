/* Paper Football — the paper, the input, the match controller. Needs engine.js on the same page. */
/* ===== APP: paper rendering, input, match controller ===== */
(function () {
  'use strict';
  var ENG = window.FBEngine;
  function $(id) { return document.getElementById(id); }

  /* ---------- config ---------- */
  var cfg = {
    cellCols: 8, cellRows: 12, goalHalf: 1,
    mode: 'youP1', level: 'normal', sound: true, hints: true, theme: 'light'
  };
  (function loadPrefs() {
    try {
      var raw = localStorage.getItem('paperfootball.cfg');
      if (raw) { var p = JSON.parse(raw); for (var k in p) if (cfg.hasOwnProperty(k)) cfg[k] = p[k]; }
    } catch (e) {}
  })();
  /* a strength remembered by an older build may name a level that no longer exists */
  if (!(window.FBEngine && FBEngine.LEVELS[cfg.level])) cfg.level = 'normal';
  /* index.html#demo starts a CPU vs CPU game you can watch; #level=master|expert|hard|normal|easy
     picks the strength for this opening; #dark (or #theme=dark / #theme=light) picks the paper.
     None of them is written back to the saved settings. */
  try {
    var startHash = String((window.location && window.location.hash) || '').toLowerCase();
    if (startHash.indexOf('demo') >= 0) cfg.mode = 'demo';
    var lv = /level=(easy|normal|hard|expert|master)/.exec(startHash);
    if (lv) cfg.level = lv[1];
    if (startHash.indexOf('dark') >= 0) cfg.theme = 'dark';
    var th = /theme=(light|dark|auto)/.exec(startHash);
    if (th) cfg.theme = th[1];
  } catch (e) {}
  function savePrefs() { try { localStorage.setItem('paperfootball.cfg', JSON.stringify(cfg)); } catch (e) {} }
  /* Paper: 'light' is the shipped look (blue-black ballpoint on graph paper), 'dark' is the same
     game in a green and a pale-blue pencil on dark paper, 'auto' follows the system. The default is
     light on purpose — the paper-and-pen look is the point of this thing. */
  function systemDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }
  function themeWanted() {
    return cfg.theme === 'dark' || (cfg.theme !== 'light' && systemDark());
  }
  function themeChoice() {
    return ['light', 'dark', 'auto'].indexOf(cfg.theme) >= 0 ? cfg.theme : 'light';
  }

  var BOARD_PRESETS = { '6,10': [6, 10], '8,12': [8, 12], '10,16': [10, 16] };

  /* ---------- key bindings: P1 = numpad / I O P K L , . /  (or arrows), P2 = Q W E A S D Z X C ---------- */
  var PAD = [
    { dir: 0, p1: [['Numpad7', 'num 7'], ['KeyI', 'I']], p2: [['KeyQ', 'Q']] },
    { dir: 1, p1: [['Numpad8', 'num 8'], ['KeyO', 'O'], ['ArrowUp', '↑']], p2: [['KeyW', 'W']] },
    { dir: 2, p1: [['Numpad9', 'num 9'], ['KeyP', 'P']], p2: [['KeyE', 'E']] },
    { dir: 3, p1: [['Numpad4', 'num 4'], ['KeyK', 'K'], ['ArrowLeft', '←']], p2: [['KeyA', 'A']] },
    { dir: 4, p1: [['Numpad6', 'num 6'], ['KeyL', 'L'], ['Semicolon', ';'], ['ArrowRight', '→']], p2: [['KeyD', 'D']] },
    { dir: 5, p1: [['Numpad1', 'num 1'], ['KeyComma', ',']], p2: [['KeyZ', 'Z']] },
    { dir: 6, p1: [['Numpad2', 'num 2'], ['KeyPeriod', '.'], ['ArrowDown', '↓']], p2: [['KeyX', 'X']] },
    { dir: 7, p1: [['Numpad3', 'num 3'], ['KeySlash', '/']], p2: [['KeyC', 'C']] }
  ];
  var CODE2DIR = [{}, {}];
  PAD.forEach(function (p) {
    p.p1.forEach(function (b) { CODE2DIR[0][b[0]] = p.dir; });
    p.p2.forEach(function (b) { CODE2DIR[1][b[0]] = p.dir; });
  });

  /* ---------- state ---------- */
  var match = null, board = null, cpu = null;
  var phase = 'wait';               /* wait | think | anim | over */
  var anim = null, flash = null, hint = null, toast = null, hoverNode = -1;
  var strokes = [], lastAiInfo = '';
  var logLines = [];

  function isHuman(side) {
    if (cfg.mode === '2p') return true;
    if (cfg.mode === 'demo') return false;
    return (cfg.mode === 'youP1') ? side === 0 : side === 1;
  }
  function nameOf(side) { return isHuman(side) ? (side === 0 ? 'Player 1' : 'Player 2') : 'CPU'; }
  function colorOf(side) { return side === 0 ? T.p1 : T.p2; }
  /* The sheet is hand-drawn on a canvas, so its palette is spelled out here too (the CSS
     variables cover the panels around it). Light is pencil on graph paper, graphite and blue; on dark paper, where graphite would be
     invisible, Player 1 is a green pencil (football.pyw's colour for that side) and Player 2 a deep blue — both
      kept deep rather than pastel, so on dark paper they still read as lead and not as highlighter. applyTheme() swaps the palette and repaints. */
  var THEMES = {
    light: { field:'#eef0fa', grid:'rgba(160,200,230,.72)', dots:'rgba(30,0,130,.16)', fibre:'rgba(30,0,130,',
             ink:'#1e0082', p1:'#2b2d38', p2:'#2f5fd0', warn:'#c01414',
             toast:'rgba(30,0,130,.75)', veil:'rgba(238,240,250,.72)', shadow:'rgba(30,0,130,0.14)' },
    dark:  { field:'#171a20', grid:'rgba(130,158,196,.34)', dots:'rgba(214,224,242,.20)', fibre:'rgba(255,255,255,',
             ink:'#e9edf6', p1:'#2fb877', p2:'#5f93ee', warn:'#ff8080',
             toast:'rgba(226,233,246,.85)', veil:'rgba(21,23,29,.78)', shadow:'rgba(0,0,0,.45)' }
  };
  var T = THEMES.light;
  /* Paint the theme before anything is drawn: the page grid and the canvas sheet have to change
     together, so there is never a moment of half-light on load or when the theme is switched. */
  function applyTheme() {
    var dark = themeWanted();
    T = dark ? THEMES.dark : THEMES.light;
    try { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); } catch (e) {}
    var sel = $('selTheme');
    if (sel) { try { sel.value = themeChoice(); } catch (e) {} }
    /* the sheet is a cached bitmap — repaint it, then re-lock the page grid to its grid */
    if (board && cwpx) { buildPaper(); syncPageGrid(); }
  }
  applyTheme();
  try {
    var mqDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mqDark && mqDark.addEventListener) {
      mqDark.addEventListener('change', function () { if (!cfg.theme) applyTheme(); });
    }
  } catch (e) {}

  /* ---------- canvas layout ---------- */
  var canvas = $('field'), ctx = canvas.getContext('2d');
  var paper = document.createElement('canvas'), pctx = paper.getContext('2d');
  var wrap = $('boardwrap');
  var cell = 40, ox = 0, oy = 0, dpr = 1, cwpx = 0, chpx = 0, margin = 1.15;

  function layout() {
    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    var cw = board.cellCols, ch = board.cellRows;
    /* The board box is the honest bound, but during first paint it can report a stale,
       content-sized value — the viewport cannot lie, so take the smaller of the two:
       never overflow the board area, never shrink because the flex layout has not settled. */
    var reserve = Math.min(360, Math.round((window.innerWidth || 1200) * 0.42));
    var availW = Math.min(Math.max(240, wrap.clientWidth - 16), Math.max(240, (window.innerWidth || 1200) - reserve));
    var availH = Math.min(Math.max(240, wrap.clientHeight - 16), Math.max(240, (window.innerHeight || 800) - 150));
    /* the sheet of paper fills the board area; the pitch is drawn centred on it */
    cwpx = Math.round(availW); chpx = Math.round(availH);
    cell = Math.floor(Math.min(cwpx / (cw + 2 * margin), chpx / (ch + 2 * margin)));
    cell = Math.max(16, cell);
    canvas.style.width = cwpx + 'px'; canvas.style.height = chpx + 'px';
    canvas.width = Math.round(cwpx * dpr); canvas.height = Math.round(chpx * dpr);
    paper.width = canvas.width; paper.height = canvas.height;
    ox = Math.round((cwpx - cw * cell) / 2); oy = Math.round((chpx - ch * cell) / 2);
    lastAw = wrap.clientWidth; lastAh = wrap.clientHeight;
    buildPaper();
    syncPageGrid();
  }
  /* the paper on the page behind the panels is the same sheet, not a second grid */
  function syncPageGrid() {
    if (!document.documentElement || !document.documentElement.style) return;
    var root = document.documentElement.style;
    root.setProperty('--gs', cell + 'px');
    var r = canvas.getBoundingClientRect();
    root.setProperty('--gx', Math.round(r.left + ox) + 'px');
    root.setProperty('--gy', Math.round(r.top + oy) + 'px');
  }
  /* The very first layout() runs before the browser has settled the page box, and the
     window can be resized or the sidebar wrapped afterwards — re-measure, but only when
     the board area really changed size, so the paper is never rebuilt on every event. */
  var lastAw = -1, lastAh = -1, relayoutPending = false;
  function relayout() {
    if (relayoutPending) return;
    relayoutPending = true;
    requestAnimationFrame(function () {
      relayoutPending = false;
      if (!board) return;
      var aw = wrap.clientWidth, ah = wrap.clientHeight;
      if (Math.abs(aw - lastAw) > 4 || Math.abs(ah - lastAh) > 4) layout();
    });
  }
  function nx(node) { return ox + (node % board.W) * cell; }
  function ny(node) { return oy + ((node / board.W) | 0) * cell; }
  function nodeAt(x, y) {
    var c = Math.round((x - ox) / cell), r = Math.round((y - oy) / cell);
    if (c < 0 || c >= board.W || r < 0 || r >= board.H) return -1;
    var n = r * board.W + c;
    if (Math.abs(x - nx(n)) > cell * 0.44 || Math.abs(y - ny(n)) > cell * 0.44) return -1;
    return n;
  }

  /* ---------- hand-drawn primitives ---------- */
  function pr(seed) { var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function ctrl(x1, y1, x2, y2, seed) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / len, py = dx / len, wob = Math.min(1.8, len * 0.055);
    var o1 = (pr(seed) * 2 - 1) * wob, o2 = (pr(seed + 7.3) * 2 - 1) * wob;
    return [x1 + dx * 0.3 + px * o1, y1 + dy * 0.3 + py * o1, x1 + dx * 0.7 + px * o2, y1 + dy * 0.7 + py * o2];
  }
  function pen(c, x1, y1, x2, y2, seed, color, w, alpha, tEnd) {
    var cc = ctrl(x1, y1, x2, y2, seed);
    c.beginPath(); c.moveTo(x1, y1);
    if (tEnd == null || tEnd >= 1) {
      c.bezierCurveTo(cc[0], cc[1], cc[2], cc[3], x2, y2);
    } else {
      for (var i = 1; i <= 16; i++) {
        var t = (i / 16) * tEnd, m = 1 - t;
        c.lineTo(m * m * m * x1 + 3 * m * m * t * cc[0] + 3 * m * t * t * cc[2] + t * t * t * x2,
                 m * m * m * y1 + 3 * m * m * t * cc[1] + 3 * m * t * t * cc[3] + t * t * t * y2);
      }
    }
    c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round';
    c.stroke(); c.globalAlpha = 1;
  }
  /* The players' pencil strokes are deliberately lighter than the printed pitch: a real
     pencil line over pre-printed graph paper is thinner than the print, not heavier. */
  function strokeW() { return Math.max(1.0, cell * 0.034); }
  function ink(c, x1, y1, x2, y2, seed, color, w, tEnd) {
    pen(c, x1, y1, x2, y2, seed, color, w * 1.8, 0.07, tEnd);
    pen(c, x1, y1, x2, y2, seed, color, w, 0.88, tEnd);
    pen(c, x1, y1, x2, y2, seed + 3.7, color, w * 0.5, 0.30, tEnd);
  }
  function drawBall(c, x, y, r, seed) {
    c.save(); c.translate(x, y);
    c.fillStyle = T.shadow;
    c.beginPath(); c.ellipse(0, r * 0.30, r * 1.05, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    var i, a, rr, N = 18;
    c.beginPath();
    for (i = 0; i <= N; i++) {
      a = (i / N) * Math.PI * 2; rr = r * (1 + 0.04 * (pr(seed + i) * 2 - 1));
      if (i) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath(); c.fillStyle = '#fdfdf5'; c.fill();
    c.strokeStyle = '#1b1b2a'; c.lineWidth = Math.max(1, r * 0.10); c.stroke();
    c.beginPath();
    for (i = 0; i < 5; i++) {
      a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      if (i) c.lineTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42); else c.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
    }
    c.closePath(); c.fillStyle = '#24243a'; c.fill();
    c.strokeStyle = 'rgba(36,36,58,.7)'; c.lineWidth = Math.max(0.7, r * 0.06);
    for (i = 0; i < 5; i++) {
      a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      c.beginPath(); c.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42); c.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88); c.stroke();
    }
    c.restore();
  }

  /* ---------- the printed pitch (static layer) ---------- */
  function buildPaper() {
    var c = pctx, i, n;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cwpx, chpx);
    c.fillStyle = T.field; c.fillRect(0, 0, cwpx, chpx);
    /* paper fibre */
    for (i = 0; i < 1100; i++) {
      var x = pr(i * 3.7) * cwpx, y = pr(i * 7.1 + 5) * chpx;
      c.fillStyle = T.fibre + (0.012 + pr(i * 1.3) * 0.022) + ')';
      c.fillRect(x, y, 1, 1);
    }
    /* graph paper grid, aligned with the lattice and covering the whole sheet, so the
       page background outside the canvas can be made to continue it seamlessly */
    c.strokeStyle = T.grid; c.lineWidth = 1;
    c.beginPath();
    for (var col = Math.ceil(-ox / cell); col <= Math.floor((cwpx - ox) / cell); col++) {
      var gx = ox + col * cell; c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, chpx);
    }
    for (var row = Math.ceil(-oy / cell); row <= Math.floor((chpx - oy) / cell); row++) {
      var gy = oy + row * cell; c.moveTo(0, gy + 0.5); c.lineTo(cwpx, gy + 0.5);
    }
    c.stroke();
    /* node dots — only where the game can actually be played */
    c.fillStyle = T.dots;
    for (n = 0; n < board.N; n++) { if (!board.inPlay[n]) continue; c.beginPath(); c.arc(nx(n), ny(n), Math.max(1.1, cell * 0.045), 0, Math.PI * 2); c.fill(); }

    /* goals. The two short lines at the posts are printed pitch lines; the net belongs
       between them — inside the goal frame, not hanging out of it — and the ball enters
       through the gap in the goal line. */
    for (var side = 0; side < 2; side++) {
      var nodes = board.goalNodes[side], colr = colorOf(side);
      var x1 = nx(nodes[0]), x2 = nx(nodes[nodes.length - 1]);
      var postY = side === 0 ? oy : ny((board.H - 1) * board.W);            /* back of the goal */
      var lineY = side === 0 ? ny(board.W) : ny((board.H - 2) * board.W);   /* the goal line   */
      c.fillStyle = colr; c.globalAlpha = 0.07;
      c.fillRect(x1, Math.min(postY, lineY), x2 - x1, Math.abs(lineY - postY)); c.globalAlpha = 1;
      c.strokeStyle = colr; c.globalAlpha = 0.5; c.lineWidth = 1;
      c.beginPath();
      for (var s = 1; s < 7; s++) { var gx2 = x1 + (x2 - x1) * s / 7; c.moveTo(gx2, postY); c.lineTo(gx2, lineY); }
      c.moveTo(x1, postY); c.lineTo(x2, postY); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = colr;
      c.font = 'italic ' + Math.round(cell * 0.34) + 'px Georgia, serif';
      c.textAlign = 'center'; c.textBaseline = side === 0 ? 'bottom' : 'top';
      var labelY = side === 0 ? postY - cell * 0.45 : postY + cell * 0.45;
      c.fillText(side === 0 ? 'P1 attacks this goal' : 'P2 attacks this goal', (x1 + x2) / 2, labelY);
    }

    /* printed pitch lines — one weight, one darkness: this is the printed border of the
       pitch, and it is meant to read as heavier than anything the players draw. The other
       blocked strokes are off the pitch, so they are not drawn at all. */
    for (i = 0; i < board.E; i++) {
      if (!board.printVisible[i]) continue;
      var en = board.edgeNodes[i];
      var x11 = nx(en[0]), y11 = ny(en[0]), x22 = nx(en[1]), y22 = ny(en[1]);
      pen(c, x11, y11, x22, y22, i * 1.7 + 0.3, T.ink, Math.max(1.6, cell * 0.055), 0.92);
    }
  }

  /* ---------- dynamic layer ---------- */
  /* Everything animated is measured against the render clock — the timestamp requestAnimationFrame
     hands us — never against performance.now(). The timestamp of the *next* frame is earlier than
     performance.now() read inside the current one, and a throttled tab, a long CPU search or a
     headless run pulls the two clocks further apart; mixing them makes an eased stroke overshoot
     backwards past the ball. */
  var lastTs = performance.now();
  function frame(ts) {
    if (typeof ts !== 'number' || !(ts >= 0)) ts = performance.now();
    lastTs = ts;
    if (anim && ts - anim.t0 >= anim.dur) {
      anim = null;
      afterStroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var i, st, sw = strokeW();
    for (i = 0; i < strokes.length; i++) {
      st = strokes[i];
      var isLast = i === strokes.length - 1;
      if (anim && isLast) {
        var t = Math.min(1, (ts - anim.t0) / anim.dur);
        var e = 1 - Math.pow(1 - t, 2.2);
        ink(ctx, nx(st.from), ny(st.from), nx(st.to), ny(st.to), st.edge * 2.3 + 11, colorOf(st.side), sw, e);
      } else {
        ink(ctx, nx(st.from), ny(st.from), nx(st.to), ny(st.to), st.edge * 2.3 + 11, colorOf(st.side), sw);
      }
    }

    /* ball position (interpolated while a stroke is being drawn) */
    var bx = nx(match.ps.ball), by = ny(match.ps.ball);
    if (anim) {
      var t2 = Math.min(1, (ts - anim.t0) / anim.dur), e2 = 1 - Math.pow(1 - t2, 2.2);
      bx = nx(anim.mv.from) + (nx(anim.mv.to) - nx(anim.mv.from)) * e2;
      by = ny(anim.mv.from) + (ny(anim.mv.to) - ny(anim.mv.from)) * e2;
    }

    /* legal-move dots and hover preview for the human to move */
    if (cfg.hints && phase === 'wait') {
      var ms = match.moves(), col = colorOf(match.ps.side);
      ctx.save();
      for (i = 0; i < ms.length; i++) {
        var mv = ms[i];
        ctx.beginPath(); ctx.arc(nx(mv.to), ny(mv.to), Math.max(2.4, cell * 0.10), 0, Math.PI * 2);
        ctx.strokeStyle = col; ctx.globalAlpha = hoverNode === mv.to ? 0.95 : 0.42; ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (hoverNode >= 0) {
        for (i = 0; i < ms.length; i++) if (ms[i].to === hoverNode) {
          ctx.setLineDash([4, 4]);
          pen(ctx, bx, by, nx(hoverNode), ny(hoverNode), 99, col, 2.2, 0.8);
          ctx.setLineDash([]);
          if (ms[i].isBounce) {
            ctx.fillStyle = T.warn; ctx.font = 'bold ' + Math.round(cell * 0.3) + 'px Georgia, serif';
            ctx.textAlign = 'center'; ctx.fillText('bounce!', (bx + nx(hoverNode)) / 2, (by + ny(hoverNode)) / 2 - cell * 0.18);
          }
          if (ms[i].isGoal) {
            ctx.fillStyle = col; ctx.font = 'bold ' + Math.round(cell * 0.3) + 'px Georgia, serif';
            ctx.textAlign = 'center'; ctx.fillText('GOAL', (bx + nx(hoverNode)) / 2, (by + ny(hoverNode)) / 2 - cell * 0.18);
          }
          break;
        }
      }
      ctx.restore();
    }
    if (hint) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.85;
      pen(ctx, nx(hint.from), ny(hint.from), nx(hint.to), ny(hint.to), 55, T.warn, 2.2, 0.9);
      ctx.setLineDash([]); ctx.restore();
      if (lastTs > hint.until) hint = null;
    }

    /* turn ring */
    if (!match.over && phase !== 'anim') {
      var pulse = 0.5 + 0.5 * Math.sin(ts / 260);
      ctx.strokeStyle = colorOf(match.ps.side); ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(bx, by, cell * 0.52 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    drawBall(ctx, bx, by, cell * 0.30, 7);

    /* bounce flash */
    if (flash && lastTs < flash.until) {
      ctx.fillStyle = T.warn; ctx.globalAlpha = 0.85;
      ctx.font = 'italic ' + Math.round(cell * 0.42) + 'px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText('bounce — kick again!', bx, by - cell * 0.95);
      ctx.globalAlpha = 1;
    } else if (flash) flash = null;

    if (toast && lastTs < toast.until) {
      ctx.fillStyle = toast.color; ctx.globalAlpha = 0.9;
      ctx.font = 'italic ' + Math.round(cell * 0.4) + 'px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText(toast.text, cwpx / 2, oy - cell * 0.35);
      ctx.globalAlpha = 1;
    } else if (toast) toast = null;

    if (match.over) {
      ctx.fillStyle = T.veil; ctx.fillRect(0, 0, cwpx, chpx);
      ctx.textAlign = 'center';
      /* the winner announced in the winner's own pen, not in a red stamp: on this sheet the colour
         of a side is already the only thing that says who drew what */
      ctx.fillStyle = colorOf(match.winner);
      ctx.font = 'bold ' + Math.round(cell * 1.05) + 'px Cambria, Georgia, serif';
      ctx.fillText(nameOf(match.winner) + ' won!', cwpx / 2, chpx / 2 - cell * 0.2);
      ctx.fillStyle = T.ink; ctx.font = 'italic ' + Math.round(cell * 0.42) + 'px Georgia, serif';
      ctx.fillText(explainEnd() + '   —   press F5 for a new game', cwpx / 2, chpx / 2 + cell * 0.6);
    }
    /* The board area can settle to its real size well after boot — fonts loading, the
       window finishing its own layout, a sidebar wrapping — so keep checking cheaply
       from the render loop instead of trusting one measurement plus window events. */
    if ((frameTicks++ % 24) === 0) relayout();
    requestAnimationFrame(frame);
  }
  var frameTicks = 0;

  function explainEnd() {
    if (match.reason === 'no strokes left') return 'no stroke left to draw';
    if (match.reason === 'own goal') return 'won by an own goal';
    return 'the winning stroke ended in the ' + (match.winner === 0 ? 'top' : 'bottom') + ' goal';
  }

  /* ---------- match controller ---------- */
  function newMatch() {
    stopThinking();
    match = ENG.createMatch(cfg); board = match.board; cpu = match.cpu;
    strokes = match.strokes(); logLines = []; lastAiInfo = '';
    anim = null; flash = null; hint = null; toast = null; hoverNode = -1;
    padSide = -1;
    $('log').textContent = '';
    layout();
    logLine('— new game: ' + nameOf(0) + ' vs ' + nameOf(1) + ' —', '');
    pump();
    refreshUi();
  }
  function afterStroke() {
    strokes = match.strokes();
    if (match.over) { phase = 'over'; refreshUi(); return; }
    pump();
    refreshUi();
  }
  function pump() {
    if (match.over) { phase = 'over'; return; }
    var side = match.ps.side;
    if (isHuman(side)) { phase = 'wait'; }
    else { phase = 'think'; askCpu(side); }
  }
  function doKick(mv) {
    if (!mv) return;
    var evt = match.play(mv);
    if (!evt) return;
    kickSound();
    strokes = match.strokes();
    var dur = cfg.mode === 'demo' ? 150 : 210;
    anim = { mv: { from: evt.from, to: evt.to }, t0: lastTs, dur: dur };
    phase = 'anim';
    reportEvent(evt);
    refreshUi();
  }
  function reportEvent(evt) {
    var who = nameOf(evt.side);
    if (evt.goal) {
      logLine((evt.ownGoal ? 'OWN GOAL — ' : 'GOAL — ') + nameOf(evt.scorer) + ' ' + match.scores[0] + '–' + match.scores[1], evt.scorer === 0 ? 'g1' : 'g2');
      toast = { text: evt.ownGoal ? 'own goal!' : 'GOAL!', color: T.warn, until: lastTs + 1400 };
    }
    if (evt.bounce && !evt.goal) flash = { until: lastTs + 900 };
    if (evt.stuck) logLine('no stroke left — ' + nameOf(match.winner) + ' wins', match.winner === 0 ? 'g1' : 'g2');
  }
  function logLine(text, cls) {
    logLines.push({ text: text, cls: cls });
    if (logLines.length > 40) logLines.shift();
    var el = $('log');
    el.innerHTML = logLines.map(function (l) {
      return l.cls ? '<span class="' + l.cls + '">' + escapeHtml(l.text) + '</span>' : escapeHtml(l.text);
    }).join('\n');
    el.scrollTop = el.scrollHeight;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  /* the small grey line under the status: what is drawn, how big the pitch is, and — after a
     CPU kick — how deep the search actually got. Kept in one place because the CPU writes it
     while it thinks, one slice at a time. */
  function subLine() {
    if (!match || !match.board) return '';
    return 'strokes drawn: ' + strokesDrawn() + ' / ' + match.board.playable +
      ' · pitch ' + match.board.cellCols + '×' + match.board.cellRows + ' cells (' + match.board.W + '×' + match.board.H + ' dots)' +
      (lastAiInfo ? '<br>' + escapeHtml(lastAiInfo) : '');
  }

  /* ---------- CPU ----------
     The CPU thinks on the page's own thread, in slices of about 60 ms, yielding to the browser
     between them so the paper keeps drawing. It is not in a worker because a page opened
     straight from disk cannot load one: measured in current Chrome from a file:// page,
     new Worker('engine.js'), importScripts, fetch and XMLHttpRequest all fail — the origin is
     'null'. The slices are not wasted work: the search keeps its table and starts one ply past
     any proof it already holds, so a slice that follows a slice buys depth instead of repeating
     it, and a position that is already proved is answered from the table without any searching.
     The depth it has actually proved is written on the paper while it thinks. */
  var thinkTimer = null, thinkSeq = 0, thinkMs = 0, thinkNodes = 0, SLICE_MS = 60;
  function stopThinking() { thinkSeq++; if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; } }
  /* One sentence about what the CPU really did. This used to print "proved depth 1 of 12" for a
     move that was answered without any new searching at all, because the position had already been
     searched during an earlier kick and the answer came out of the table. That is the most
     impressive thing the engine does and it looked like the least; so the sentence now says which
     of the three things actually happened. */
  function aiInfo(mv) {
    var lv = ENG.LEVELS[cfg.level] || ENG.LEVELS.normal;
    var head = 'CPU ' + cfg.level + ': ';
    var cost = ', ' + thinkNodes.toLocaleString() + ' positions, ' + (thinkMs / 1000).toFixed(1) + ' s';
    if (mv.fromTable) {
      return head + 'no new search: this position was already searched to ' + mv.tableDepth +
        ' plies during an earlier kick, the move comes out of that proof' +
        (mv.tableDepth > lv.depth ? ' (this level only asks for ' + lv.depth + ')' : '');
    }
    if (mv.partial) {
      return head + 'the clock ended the search before it proved even one ply — this is the best move' +
        ' that partial walk found, and the paper keeps the thinking going on the next kick' +
        (thinkNodes ? cost : '');
    }
    return head + 'proved depth ' + mv.depth + ' of ' + lv.depth +
      (thinkNodes ? cost : ', and the table answered every branch of it — not one new position was searched');
  }
  function askCpu(side) {
    var lv = ENG.LEVELS[cfg.level] || ENG.LEVELS.normal;
    var total = Math.max(150, lv.budget), t0 = Date.now(), best = null, mine = ++thinkSeq;
    thinkMs = 0; thinkNodes = 0;
    function finish() {
      if (mine !== thinkSeq) return;
      thinkSeq++; thinkTimer = null;
      applyCpuMove(best);
    }
    function step() {
      if (mine !== thinkSeq || phase !== 'think') return;
      var left = total - (Date.now() - t0);
      var mv = cpu.choose(cfg.level, match.ps, left > SLICE_MS ? SLICE_MS : Math.max(60, left));
      if (mv) {
        best = mv;
        /* what this slice cost, added up: the depth shown is what the position is now proven
           to, part of which may have been proved during an earlier kick */
        thinkMs += mv.ms || 0; thinkNodes += mv.nodes || 0;
        lastAiInfo = 'CPU ' + cfg.level + ': ' +
          (mv.partial || mv.depth < 1 ? 'still on its first ply' : 'searched to ' + mv.depth + ' of ' + lv.depth + ' plies') +
          ', ' + thinkNodes.toLocaleString() + ' positions, ' + (thinkMs / 1000).toFixed(1) + ' s so far';
        $('substatus').innerHTML = subLine();
      }
      /* proved as deep as this level asks: thinking more would prove the same thing again */
      if ((best && best.depth >= lv.depth) || left <= SLICE_MS) { finish(); return; }
      thinkTimer = setTimeout(step, 0);
    }
    thinkTimer = setTimeout(step, 0);
  }
  function applyCpuMove(mv) {
    if (phase !== 'think') return;
    if (!mv) {
      match.over = true; match.winner = match.ps.side ^ 1; match.reason = 'no strokes left';
      logLine('no stroke left — ' + nameOf(match.winner) + ' wins', match.winner === 0 ? 'g1' : 'g2');
      phase = 'over'; refreshUi(); return;
    }
    lastAiInfo = aiInfo(mv);
    doKick(mv);
  }

  /* ---------- UI ---------- */
  var padSide = -1;
  function buildPad(side) {
    if (side === padSide) return;
    padSide = side;
    var pad = $('pad');
    pad.replaceChildren();
    [0, 1, 2, 3, -1, 4, 5, 6, 7].forEach(function (d) {
      if (d === -1) {
        var mid = document.createElement('div');
        mid.className = 'mid'; mid.textContent = 'kick';
        pad.appendChild(mid); return;
      }
      var p = PAD[d];
      var el = document.createElement('div');
      el.className = 'k hintable'; el.dataset.dir = d;
      el.innerHTML = padLabel(p, side);
      el.addEventListener('click', function () { kickDir(d); });
      pad.appendChild(el);
    });
  }
  function padLabel(p, side) {
    var arr = side === 0 ? p.p1 : p.p2;
    if (side !== 0) return '<b>' + arr.map(function (b) { return b[1]; }).join(' · ') + '</b>';
    var num = arr.filter(function (b) { return b[0].indexOf('Numpad') === 0; })
      .map(function (b) { return b[1].replace('num ', ''); });
    var letters = arr.filter(function (b) { return b[0].indexOf('Numpad') !== 0; })
      .map(function (b) { return b[1]; });
    return '<b>' + letters.join(' ') + '</b>' + (num.length ? '<small>num ' + num.join(' ') + '</small>' : '');
  }
  function refreshUi() {
    $('sc1').textContent = match.scores[0];
    $('sc2').textContent = match.scores[1];
    $('box1').firstChild.textContent = nameOf(0) + (cfg.mode !== '2p' && cfg.mode !== 'demo' && isHuman(0) ? ' (you)' : '');
    $('box2').firstChild.textContent = nameOf(1) + (cfg.mode !== '2p' && cfg.mode !== 'demo' && isHuman(1) ? ' (you)' : '');
    $('box1').classList.toggle('active', !match.over && match.ps.side === 0);
    $('box2').classList.toggle('active', !match.over && match.ps.side === 1);

    var st = $('status'), sub = $('substatus'), pw = $('padwrap');
    var side = match.ps.side, col = side === 0 ? 'p1' : 'p2';
    buildPad(side);
    pw.className = 'padwrap ' + col + (phase === 'wait' && isHuman(side) ? '' : ' idle');
    $('padTitle').textContent = nameOf(side) + "'s keys" + (isHuman(side) && phase === 'wait' ? ' — click to kick' : '');
    Array.prototype.forEach.call($('pad').children, function (el) {
      if (el.dataset.dir == null) return;
      el.classList.toggle('dead', !(phase === 'wait' && isHuman(side)));
    });

    if (match.over) {
      st.innerHTML = '<b>' + nameOf(match.winner) + ' won</b><br>' + explainEnd();
    } else if (phase === 'think') {
      st.innerHTML = nameOf(side) + ' is thinking<span class="again">…</span>';
    } else {
      var msg = nameOf(side) + ' to kick';
      if (phase === 'wait' && isHuman(side) && midBounceChain()) msg += ' <span class="again">— bounce, kick again!</span>';
      st.innerHTML = msg;
    }
    sub.innerHTML = subLine();
    /* only the label spans are rewritten, so the key pills keep their styling */
    $('modeLbl').textContent = (cfg.mode === '2p' ? 'vs CPU' : '2 players');
    $('soundLbl').textContent = 'Sound ' + (cfg.sound ? 'on' : 'off');
    $('bUndo').disabled = !match.hist.length || phase === 'anim' || phase === 'think';
    $('bHint').disabled = !(phase === 'wait' && isHuman(match.ps.side));
  }
  /* true when the position on the paper is the middle of a bounce chain: the same
     player has to kick again, and the ball really is where that last stroke ended */
  function midBounceChain() {
    var h = match.hist;
    if (!h.length) return false;
    var r = h[h.length - 1];
    if (r.kind !== 'move') return false;
    return r.mv.isBounce && !match.over && match.ps.ball === r.mv.to;
  }
  function strokesDrawn() {
    var n = 0, u = match.ps.used;
    for (var i = 0; i < u.length; i++) if (u[i]) n++;
    return n - board.preCount;
  }

  function kickDir(dir) {
    if (phase !== 'wait') return;
    var side = match.ps.side;
    if (!isHuman(side)) return;
    var mv = match.pick(dir);
    if (!mv) { invalid(); return; }
    doKick(mv);
  }
  function invalid() {
    toast = { text: 'no such stroke', color: T.toast, until: lastTs + 700 };
  }
  function notMyTurn() {
    toast = { text: nameOf(match.ps.side) + ' is to kick', color: T.toast, until: lastTs + 800 };
  }

  /* ---------- input ---------- */
  function toggleCpu() {
    cfg.mode = cfg.mode === '2p' ? 'youP1' : '2p';
    $('selMode').value = cfg.mode; savePrefs(); newMatch();
  }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('help').hidden = true; return; }
    var code = e.code || '';
    /* H asks for a hint — the key people reach for, and one the key pads leave free. T still
       works. Help is F1, because ?, / and the letters around it all belong to the players. */
    if (code === 'F1') { e.preventDefault(); $('help').hidden = !$('help').hidden; return; }
    if (code === 'F3') { e.preventDefault(); toggleCpu(); return; }
    /* A bare F5 starts a new match instead of reloading the page. Ctrl+F5 and Ctrl+R are left to the
       browser, so "start over" is one key and "throw this page away" is still a chord. */
    if (code === 'F5') { if (e.ctrlKey || e.metaKey || e.altKey) return; e.preventDefault(); newMatch(); return; }
    if (code === 'KeyU') { e.preventDefault(); doUndo(); return; }
    if (code === 'KeyH' || code === 'KeyT') { e.preventDefault(); doHint(); return; }
    if (code === 'KeyM') { e.preventDefault(); cfg.sound = !cfg.sound; savePrefs(); refreshUi(); return; }
    if (code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.repeat) return;
    initAudio();
    for (var side = 0; side < 2; side++) {
      if (CODE2DIR[side][code] == null) continue;
      if (phase === 'think') return;
      if (phase !== 'wait' || match.ps.side !== side || !isHuman(side)) { notMyTurn(); return; }
      kickDir(CODE2DIR[side][code]);
      return;
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var r = canvas.getBoundingClientRect();
    hoverNode = nodeAt((e.clientX - r.left), (e.clientY - r.top));
  });
  canvas.addEventListener('pointerleave', function () { hoverNode = -1; });
  canvas.addEventListener('pointerdown', function (e) {
    initAudio();
    var r = canvas.getBoundingClientRect();
    var n = nodeAt((e.clientX - r.left), (e.clientY - r.top));
    if (n < 0 || phase !== 'wait') return;
    var side = match.ps.side; if (!isHuman(side)) return;
    var ms = match.moves();
    for (var i = 0; i < ms.length; i++) if (ms[i].to === n) { doKick(ms[i]); return; }
    invalid();
  });

  function doUndo() {
    if (phase === 'anim' || phase === 'think') return;
    if (!match.hist.length) return;
    var solo = cfg.mode === 'youP1' || cfg.mode === 'youP2';
    match.undo();
    if (solo) {
      /* in solo play one press rewinds the CPU's reply too, back to my own kick */
      var guard = 0;
      while (match.hist.length && guard++ < 400) {
        if (match.over || isHuman(match.ps.side)) break;
        match.undo();
      }
    }
    strokes = match.strokes(); anim = null; hint = null; flash = null;
    logLine('— one kick erased —', '');
    pump(); refreshUi();
  }
  function doHint() {
    if (phase !== 'wait') return;
    var side = match.ps.side; if (!isHuman(side)) return;
    var mv = cpu.choose(cfg.level === 'easy' ? 'hard' : cfg.level, ENG.cloneState(board, match.ps), 900);
    if (!mv) { invalid(); return; }
    hint = { from: mv.from, to: mv.to, until: lastTs + 2500 };
    logLine('hint: ' + dirName(mv.dir) + (mv.isBounce ? ' (bounce)' : ''), side === 0 ? 'g1' : 'g2');
  }
  function dirName(d) { return ['up-left', 'up', 'up-right', 'left', 'right', 'down-left', 'down', 'down-right'][d]; }

  /* ---------- sound: prefers the original kick (n).wav when served over http ---------- */
  var actx = null, kickBufs = null, kickTried = false;
  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    if (actx && !kickTried) {
      kickTried = true;
      var names = ['kick (1).wav', 'kick (2).wav', 'kick (3).wav'];
      Promise.all(names.map(function (nm) {
        return fetch(nm).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (b) { return b ? actx.decodeAudioData(b) : null; });
      })).then(function (bs) {
        var ok = bs.filter(Boolean);
        if (ok.length) kickBufs = ok;
      }).catch(function () {});
    }
  }
  function kickSound() {
    if (!cfg.sound) return;
    initAudio(); if (!actx) return;
    if (kickBufs) {
      var s = actx.createBufferSource(); s.buffer = kickBufs[(Math.random() * kickBufs.length) | 0];
      var gg = actx.createGain(); gg.gain.value = 0.45; s.connect(gg); gg.connect(actx.destination); s.start();
      return;
    }
    var now = actx.currentTime;
    var len = Math.floor(actx.sampleRate * 0.09);
    var buf = actx.createBuffer(1, len, actx.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    var src = actx.createBufferSource(); src.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 + Math.random() * 500; bp.Q.value = 1.1;
    var gg2 = actx.createGain(); gg2.gain.value = 0.5;
    src.connect(bp); bp.connect(gg2); gg2.connect(actx.destination); src.start(now);
    var osc = actx.createOscillator(); osc.frequency.value = 150 + Math.random() * 40;
    var g3 = actx.createGain(); g3.gain.setValueAtTime(0.22, now); g3.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(g3); g3.connect(actx.destination); osc.start(now); osc.stop(now + 0.14);
  }

  /* ---------- settings wiring ---------- */
  function fillLevels() {
    var sel = $('selLevel');
    Object.keys(ENG.LEVELS).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = ENG.LEVELS[k].label; sel.appendChild(o);
    });
  }
  function readSettings() {
    cfg.mode = $('selMode').value;
    cfg.level = $('selLevel').value;
    var bc = BOARD_PRESETS[$('selBoard').value] || [8, 12];
    var nCols = bc[0], nRows = bc[1];
    var restart = cfg.cellCols !== nCols || cfg.cellRows !== nRows;
    cfg.cellCols = nCols; cfg.cellRows = nRows;
    cfg.hints = $('chkHints').checked;
    var wantTheme = ['light', 'dark', 'auto'].indexOf($('selTheme').value) >= 0 ? $('selTheme').value : 'light';
    if (wantTheme !== cfg.theme) { cfg.theme = wantTheme; savePrefs(); applyTheme(); return; }
    savePrefs();
    if (restart) { newMatch(); return; }
    refreshUi();
    /* switching who controls a side must immediately let that side act */
    if (phase !== 'anim' && phase !== 'think') pump();
  }
  function applyCfgToUi() {
    $('selMode').value = cfg.mode;
    $('selLevel').value = cfg.level;
    $('selBoard').value = cfg.cellCols + ',' + cfg.cellRows;
    if (!$('selBoard').value) $('selBoard').value = '8,12';
    $('chkHints').checked = !!cfg.hints;
    $('selTheme').value = themeChoice();
  }

  $('bNew').addEventListener('click', function () { newMatch(); });
  $('bUndo').addEventListener('click', doUndo);
  $('bHint').addEventListener('click', doHint);
  $('bMode').addEventListener('click', toggleCpu);
  $('bSound').addEventListener('click', function () { cfg.sound = !cfg.sound; savePrefs(); refreshUi(); });
  $('bHelp').addEventListener('click', function () { $('help').hidden = false; });
  $('bHelpClose').addEventListener('click', function () { $('help').hidden = true; });
  $('settings').addEventListener('change', readSettings);
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);
  if (window.ResizeObserver) { try { new ResizeObserver(relayout).observe(wrap); } catch (e) {} }

  fillLevels(); applyCfgToUi(); newMatch();
  requestAnimationFrame(frame);
})();
