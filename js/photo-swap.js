/* ============================================================
   Photo spark-wipe: every HOLD ms, a glowing irregular front
   sweeps from a corner (DUR ms); swept area reveals the next
   photo, the rest keeps the current one. Loops forever.

   The front is not a plain arc: its radius is modulated along
   the angle by drifting random harmonics, so it advances like
   an evolving level set — smooth, wavy, organic.
   ============================================================ */
(function () {
  'use strict';

  // ---- config -------------------------------------------------
  var SRCS = ['images/selfie.jpg', 'images/selfie2.jpg']; // add more if you like
  var HOLD = 5000;    // ms between transitions
  var DUR  = 6000;    // ms a transition takes
  var SPARKS_PER_FRAME = 14;
  var AMP  = 0.17;    // max relative waviness of the front (0 = plain arc)
  var SAMPLES = 72;   // curve resolution

  var canvas = document.getElementById('photo-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- load images ---------------------------------------------
  var imgs = [];
  var pending = SRCS.length;
  SRCS.forEach(function (src, i) {
    var im = new Image();
    im.onload = function () { imgs[i] = im; done(); };
    im.onerror = function () { done(); };
    im.src = src;
  });

  function done() {
    if (--pending > 0) return;
    imgs = imgs.filter(Boolean);
    if (!imgs.length) return;          // nothing loaded: CSS fallback shows
    fit();
    drawCover(imgs[cur]);
    watchSize();                       // refit whenever the element's size changes
    if (imgs.length > 1 && !reduceMotion) {
      setTimeout(startTransition, HOLD);
    }
  }

  // Keep the canvas buffer in sync with its displayed size. Crucial when
  // the stylesheet applies late (slow @import fonts, first load after an
  // OS update): measuring too early bakes in the wrong buffer size and
  // the photo renders stretched/cropped until something re-measures it.
  function watchSize() {
    if (window.ResizeObserver) {
      new ResizeObserver(onResize).observe(canvas);
    }
    window.addEventListener('resize', onResize);   // also covers zoom/dpr changes
  }

  // ---- canvas sizing (retina-aware) -----------------------------
  var dpr = 1;
  function fit() {
    var r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(r.width  * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  function onResize() {
    var r = canvas.getBoundingClientRect();
    var d = window.devicePixelRatio || 1;
    if (Math.round(r.width * d) === canvas.width &&
        Math.round(r.height * d) === canvas.height) return;   // size unchanged
    fit();
    if (!animating && imgs[cur]) drawCover(imgs[cur]);
  }

  // draw an image covering the whole canvas (like object-fit: cover)
  function drawCover(im) {
    var W = canvas.width, H = canvas.height;
    var s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    var w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }

  // ---- corners: shuffle bag => uniform, no immediate repeats -----
  var CORNERS = [
    { fx: 0, fy: 0, a0: 0,             a1: Math.PI / 2 },   // top-left
    { fx: 1, fy: 0, a0: Math.PI / 2,   a1: Math.PI },       // top-right
    { fx: 1, fy: 1, a0: Math.PI,       a1: Math.PI * 1.5 }, // bottom-right
    { fx: 0, fy: 1, a0: Math.PI * 1.5, a1: Math.PI * 2 }    // bottom-left
  ];
  var bag = [], lastCorner = -1;
  function nextCorner() {
    if (!bag.length) {
      bag = [0, 1, 2, 3];
      for (var i = bag.length - 1; i > 0; i--) {           // Fisher–Yates
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
      if (bag[bag.length - 1] === lastCorner) {            // avoid repeat across refills
        bag[bag.length - 1] = bag[0];
        bag[0] = lastCorner;
      }
    }
    lastCorner = bag.pop();
    return CORNERS[lastCorner];
  }

  // ---- wavy front: random drifting harmonics ---------------------
  // r(u,t) = R * (1 + amp(p) * sum_k a_k sin(f_k*u + phi_k + w_k*t))
  var harmonics = [];
  function makeFront() {
    harmonics = [];
    var amps = [1, 0.55, 0.3];
    for (var k = 0; k < amps.length; k++) {
      harmonics.push({
        f: (2 + Math.floor(Math.random() * 4)) * (k + 1),   // spatial frequency
        phi: Math.random() * Math.PI * 2,                   // phase
        w: (0.4 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1), // drift rad/s
        a: amps[k]
      });
    }
  }
  function frontNoise(u, t) {                                // u in [0,1] -> [-1,1]
    var v = 0, norm = 0;
    for (var k = 0; k < harmonics.length; k++) {
      var h = harmonics[k];
      v += h.a * Math.sin(h.f * Math.PI * u + h.phi + h.w * t);
      norm += h.a;
    }
    return v / norm;
  }

  // ---- transition state ------------------------------------------
  var cur = 0, nxt = 1;
  var animating = false;
  var t0 = 0;
  var corner = null;
  var particles = [];
  var lastTs = 0;

  var COLORS = ['255,200,90', '255,160,60', '255,230,160', '255,120,50'];

  function startTransition() {
    corner = nextCorner();
    makeFront();
    t0 = performance.now();
    lastTs = t0;
    animating = true;
    requestAnimationFrame(frame);
  }

  function easeInOut(p) {
    return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  }

  // sample the front curve for this instant; also used for sparks
  function frontPoints(cx, cy, R, ampl, tSec) {
    var pts = [];
    for (var i = 0; i <= SAMPLES; i++) {
      var u = i / SAMPLES;
      var a = corner.a0 + u * (corner.a1 - corner.a0);
      var r = Math.max(0, R * (1 + ampl * frontNoise(u, tSec)));
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a: a });
    }
    return pts;
  }

  function frame(ts) {
    var W = canvas.width, H = canvas.height;
    var cx = corner.fx * W, cy = corner.fy * H;
    var maxR = Math.hypot(W, H);
    var dt = Math.min(50, ts - lastTs) / 1000;
    lastTs = ts;

    var p = Math.min(1, (ts - t0) / DUR);
    var tSec = (ts - t0) / 1000;
    var ampl = AMP * Math.sin(Math.PI * p);      // 0 at both ends: starts as a
    var R = easeInOut(p) * maxR * 1.03;          // point, ends fully covering

    var pts = frontPoints(cx, cy, R, ampl, tSec);

    // 1) base: current image everywhere
    drawCover(imgs[cur]);

    // 2) swept region: next image inside the wavy front
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.clip();
    drawCover(imgs[nxt]);
    ctx.restore();

    // 3) glowing wavefront + sparks
    if (p < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      strokeFront(pts, 9,   'rgba(255,140,40,0.12)');
      strokeFront(pts, 4,   'rgba(255,190,90,0.30)');
      strokeFront(pts, 1.8, 'rgba(255,235,180,0.85)');

      spawnSparks(pts, W, H);
      ctx.restore();
    }

    // 4) particles (drawn even while fading out after the wipe)
    updateParticles(dt);

    if (p >= 1 && !particles.length) {
      animating = false;
      cur = nxt;
      nxt = (cur + 1) % imgs.length;
      drawCover(imgs[cur]);                 // clean final frame
      setTimeout(startTransition, HOLD);
      return;
    }
    requestAnimationFrame(frame);
  }

  function strokeFront(pts, width, style) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  function spawnSparks(pts, W, H) {
    for (var i = 0; i < SPARKS_PER_FRAME; i++) {
      var q = pts[Math.floor(Math.random() * pts.length)];
      if (q.x < 0 || q.x > W || q.y < 0 || q.y > H) continue; // outside the photo
      var speed = (20 + Math.random() * 90) * dpr;
      var dir = q.a + (Math.random() - 0.5) * 1.6;            // mostly outward
      particles.push({
        x: q.x, y: q.y,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        life: 0.3 + Math.random() * 0.45,
        max: 0,
        r: (0.8 + Math.random() * 1.6) * dpr,
        col: COLORS[Math.floor(Math.random() * COLORS.length)],
        hot: Math.random() < 0.25
      });
      particles[particles.length - 1].max = particles[particles.length - 1].life;
    }
  }

  function updateParticles(dt) {
    if (!particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = particles.length - 1; i >= 0; i--) {
      var s = particles[i];
      s.life -= dt;
      if (s.life <= 0) { particles.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      var a = s.life / s.max;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + s.col + ',' + a.toFixed(3) + ')';
      ctx.fill();
      if (s.hot) {                                     // bright white core
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 0.45 * a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,240,' + (a * 0.9).toFixed(3) + ')';
        ctx.fill();
      }
    }
    ctx.restore();
  }
})();
