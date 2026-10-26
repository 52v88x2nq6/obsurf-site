(function () {
  "use strict";
  // The coast map, made zoomable: the same view as the drawing first, then the coast from the map data and, closer in,
  // the Anglet shore in the beach plans' look (tools/coast_map). Everything comes from this site.
  var host = document.querySelector("[data-imap]"), dataEl = document.getElementById("imap-data");
  if (!host || !dataEl || !window.Path2D || !window.fetch || !window.requestAnimationFrame) return;
  var cv = document.createElement("canvas"), ctx = cv.getContext && cv.getContext("2d");
  if (!ctx) return;
  var off = document.createElement("canvas"), octx = off.getContext("2d");
  var D = JSON.parse(dataEl.textContent), P = D.proj, DOM = D.domain, F = D.frame, BASE = host.getAttribute("data-imap");
  // Demo's example states, note and peaks wait in a template, like the site's other demo blocks
  var DM = {states: {}, sel: "", anglet: "", callout: null, peaks: []}, dmEl = document.getElementById("imap-demo");
  var dmScript = dmEl && dmEl.content && dmEl.content.querySelector("script");
  if (dmScript) DM = JSON.parse(dmScript.textContent);
  var root = document.documentElement, motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  var SREG = 0.35, SMAX = 3, LOD = 0.035;    // px a metre: most zoom away from Anglet, most at Anglet, finer coast from

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ramp(s, a, b) { return clamp((s - a) / (b - a), 0, 1); }
  function toM(lat, lon) { return [(lon - P.lon0) * P.kx, (P.lat0 - lat) * P.ky]; }
  function toLL(x, y) { return [P.lat0 - y / P.ky, P.lon0 + x / P.kx]; }

  // the Anglet shore's frame: u metres along the shore, v out to sea, ppm px a metre (tools/coast_map/strip_frame.py)
  var RB = F.bearing * Math.PI / 180, SB = Math.sin(RB), CB = Math.cos(RB);
  var AX = P.kx / (111320 * Math.cos(F.lat0 * Math.PI / 180)), AY = P.ky / 111320;
  var X0F = (F.lon0 - P.lon0) * P.kx, Y0F = (P.lat0 - F.lat0) * P.ky;
  function uvToM(u, v) { return [X0F + AX * (u * SB - v * CB), Y0F - AY * (u * CB + v * SB)]; }
  function mToUv(x, y) { var e = (x - X0F) / AX, n = (Y0F - y) / AY; return [e * SB + n * CB, n * SB - e * CB]; }
  function inFrame(x, y) { var q = mToUv(x, y); return q[0] > F.u0 && q[0] < F.u1 && q[1] > F.v0 && q[1] < F.v1; }
  var o0 = uvToM(F.u0, F.v1), o1 = uvToM(F.u0 + 1 / F.ppm, F.v1), o2 = uvToM(F.u0, F.v1 - 1 / F.ppm);
  var FM = [o1[0] - o0[0], o1[1] - o0[1], o2[0] - o0[0], o2[1] - o0[1], o0[0], o0[1]];    // frame px to map metres
  var FC = [uvToM(F.u0, F.v0), uvToM(F.u1, F.v0), uvToM(F.u1, F.v1), uvToM(F.u0, F.v1)];
  var FBOX = [Math.min(FC[0][0], FC[1][0], FC[2][0], FC[3][0]), Math.min(FC[0][1], FC[1][1], FC[2][1], FC[3][1]),
              Math.max(FC[0][0], FC[1][0], FC[2][0], FC[3][0]), Math.max(FC[0][1], FC[1][1], FC[2][1], FC[3][1])];

  // ---------------------------------------------------------------- the page's parts
  var mk = host.querySelector(".mmk"), pill = host.querySelector(".mcap"), foot = host.querySelector(".mfoot");
  var cred = host.querySelector(".mcred");
  var box = host.parentNode, legend = host.querySelector(".lgm"), card = box.querySelector(".bcard");
  cv.className = "imc";
  cv.setAttribute("aria-hidden", "true");
  var ov = document.createElement("div");
  ov.className = "imo";
  (mk.nextElementSibling || mk).after(cv, ov);
  var ctl = document.createElement("div");
  ctl.className = "imctl";
  ctl.innerHTML = '<div class="gl grp"><button type="button" data-z="in" aria-label="Zoom in">' + D.icons.plus + "</button>" +
    '<button type="button" data-z="out" aria-label="Zoom out">' + D.icons.minus + "</button></div>" +
    '<button type="button" class="gl homeb m" data-z="home" hidden>' + D.home + "</button>";
  (host.querySelector(".mtl") || host).appendChild(ctl);   // under the legend
  var hint = document.createElement("div");
  hint.className = "imhint";
  hint.setAttribute("aria-hidden", "true");
  host.appendChild(hint);
  var scale = document.createElement("span");
  scale.className = "imsc";
  scale.hidden = true;
  scale.innerHTML = "<i></i><b></b>";
  foot.insertBefore(scale, foot.firstChild);
  var homeBtn = ctl.querySelector(".homeb");
  var SAT = D.sat || null, satBtn = null, satOnly = null, satCard = null, satLive = null;   // Apple's satellite view: with a token, when asked
  if (SAT) {
    satBtn = document.createElement("button");
    satBtn.type = "button";
    satBtn.className = "gl satb m";
    satBtn.setAttribute("aria-pressed", "false");
    satBtn.textContent = SAT.label;
    satOnly = document.createElement("button");    // back to our map, and forget the yes
    satOnly.type = "button";
    satOnly.className = "satonly m";
    satOnly.hidden = true;
    satOnly.textContent = SAT.off;
    satLive = document.createElement("p");         // says so when Apple's map doesn't load
    satLive.className = "sr-only";
    satLive.setAttribute("role", "status");
    ctl.insertBefore(satBtn, homeBtn);
    ctl.insertBefore(satOnly, homeBtn);
    ctl.appendChild(satLive);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    ov.appendChild(e);
    return e;
  }
  var DOTS = {
    live: '<circle r="5.2" class="f-none s-live" stroke-width="1.6"/><circle r="2.6" class="f-live"/>',
    reports: '<circle r="5" class="f-ring"/>',
    usual: '<circle r="5" class="f-mdry s-ring" stroke-width="1.5"/><path d="M0 -5A5 5 0 0 1 0 5Z" class="f-ring"/>',
    wait: '<circle r="4.5" class="f-mdry s-lab" stroke-width="1.5"/>'
  };
  var SEL = '<circle r="10.5" fill="none" class="s-ring" stroke-width="1.5"/>';
  // beaches: [slug, name, town, lat, lon, landward east, landward south, page or ""]
  var B = D.beaches.map(function (b) {
    var m = toM(b[3], b[4]), dot = el("button", "imk"), lab = el("span", "iml", b[1]);
    dot.type = "button";
    dot.tabIndex = -1;
    return {slug: b[0], name: b[1], town: b[2], x: m[0], y: m[1], ux: b[5], uy: b[6], st: DM.states[b[0]] || "wait", href: b[7],
            dot: dot, lab: lab, anglet: b[2] === "Anglet", sx: 0, sy: 0};
  });
  var T = D.towns.map(function (t) { var m = toM(t[1], t[2]); return {x: m[0], y: m[1], lab: el("span", "iml", t[0])}; });
  var PL = D.places.map(function (t) { var m = toM(t[1], t[2]); return {x: m[0], y: m[1], lab: el("span", "iml mono", t[0])}; });
  var brLine = el("i", "imbr"), brText = el("span", "iml b"), cluster = el("span", "iml b", D.anglet[1]);
  var call = el("div", "imcall");
  if (DM.callout) call.innerHTML = DM.callout.html;
  var PK = DM.peaks.map(function (p) {
    var w = el("div", "impk");
    w.innerHTML = p[3];
    return {u: p[0], v: p[1], n: p[2], lv: p[4], el: w};
  });
  var labels = [brText, cluster].concat(B.map(function (b) { return b.lab; }), T.map(function (t) { return t.lab; }),
                                        PL.map(function (t) { return t.lab; }));
  var callB = DM.callout && B.filter(function (b) { return b.slug === DM.callout.slug; })[0];

  // ---------------------------------------------------------------- state
  var W = 1, H = 1, R = 1, home = {x: 0, y: 0, s: 1, k: 1}, cam = {x: 0, y: 0, s: 1}, ready = false, raf = 0, anim = null;
  var G = null, A = null, fade = null, aState = 0, C = {}, reef = null, furn = [], furnDirty = true, near = null, pillLast = "";
  var touched = false, away = false;    // away: zoomed in, when the info card on a wide map steps aside
  // the satellite view: st 0 not loaded, 1 loading, 2 ready; f fades Apple's map in (1) and out (0) under ours
  // bad: Apple refused or failed once on this page (a wrong token, say), so later taps say so straight away
  var sat = {on: false, st: 0, map: null, el: null, f: 0, t: 0, init: false, last: "", timer: 0, wait: 0, bad: false};

  function measure() {
    var r = host.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    R = Math.min(window.devicePixelRatio || 1, 3);
    var bw = Math.round(W * R), bh = Math.round(H * R);
    if (cv.width !== bw || cv.height !== bh) { cv.width = off.width = bw; cv.height = off.height = bh; }
    // the drawn map: viewBox 0 0 900 620, xMinYMid slice; vb = [x0, units a metre east, y0, units a metre south]
    var k = Math.max(W / 900, H / 620), vb = D.vb;
    home = {x: (W / (2 * k) - vb[0]) / vb[1], y: (310 - vb[2]) / vb[3], s: k * (vb[1] + vb[3]) / 2, k: k};
  }
  function atHome() {
    return Math.abs(cam.s / home.s - 1) < 0.01 && Math.abs(cam.x - home.x) * cam.s < 2 && Math.abs(cam.y - home.y) * cam.s < 2;
  }
  function colours() {
    var cs = getComputedStyle(host), co = getComputedStyle(ov);
    ["mdry", "mwet", "mveg", "mpaved", "minland", "msea", "mreef", "mrock", "mrockline", "mroad", "mcasing", "mpath",
     "mquai", "mquaicase", "mbld", "mbldline", "mshadow", "mcoast"].forEach(function (k) {
      C[k] = cs.getPropertyValue("--" + k).trim();
    });
    ["mlab", "ring", "lab", "zone"].forEach(function (k) { C[k] = co.getPropertyValue("--" + k).trim(); });
    reef = null;
  }
  function furniture() {
    var r0 = host.getBoundingClientRect();
    furn = [];
    [legend, pill, foot, cred, ctl, away ? null : card].forEach(function (e) {
      if (!e) return;
      var r = e.getBoundingClientRect();
      if (r.width && r.height && r.right > r0.left && r.left < r0.right && r.bottom > r0.top && r.top < r0.bottom) {
        furn.push([r.left - r0.left - 6, r.top - r0.top - 6, r.right - r0.left + 6, r.bottom - r0.top + 6]);
      }
    });
    if (sat.on) furn.push([0, H - 34, 130, H], [W - 100, H - 32, W, H]);   // Apple's logo and Legal link
  }

  // ---------------------------------------------------------------- the camera
  function clampCam(c) {
    c.s = clamp(c.s, home.s, SMAX);
    var hw = W / 2 / c.s, hh = H / 2 / c.s;
    c.x = DOM[2] - DOM[0] > 2 * hw ? clamp(c.x, DOM[0] + hw, DOM[2] - hw) : (DOM[0] + DOM[2]) / 2;
    c.y = DOM[3] - DOM[1] > 2 * hh ? clamp(c.y, DOM[1] + hh, DOM[3] - hh) : (DOM[1] + DOM[3]) / 2;
    if (c.s > SREG + 1e-9 && !sat.on) {   // this close, only along the Anglet shore (the satellite view goes anywhere)
      var q = mToUv(c.x, c.y), u = clamp(q[0], F.u0 + 200, F.u1 - 200), v = clamp(q[1], -250, 600);
      if (u !== q[0] || v !== q[1]) { var m = uvToM(u, v); c.x = m[0]; c.y = m[1]; }
    }
    return c;
  }
  function set(c) { cam = clampCam(c); req(); }
  function zoomTarget(px, py, f) {
    var wx = cam.x + (px - W / 2) / cam.s, wy = cam.y + (py - H / 2) / cam.s, s = clamp(cam.s * f, home.s, SMAX);
    if (s > SREG && cam.s <= SREG + 1e-9 && !sat.on && !inFrame(wx, wy)) s = Math.max(cam.s, SREG);
    return clampCam({x: wx - (px - W / 2) / s, y: wy - (py - H / 2) / s, s: s});
  }
  function zoomAt(px, py, f, animate) {
    var c = zoomTarget(px, py, f);
    if (animate) fly(c); else { stop(); set(c); }
  }
  function panBy(dx, dy) { set({x: cam.x - dx / cam.s, y: cam.y - dy / cam.s, s: cam.s}); }
  function stop() { anim = null; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function fly(c) {
    c = clampCam(c);
    if (motion.matches) { stop(); set(c); return; }
    var r = c.s / cam.s, d = Math.hypot(c.x - cam.x, c.y - cam.y) * Math.min(c.s, cam.s);
    anim = {kind: "fly", a: {x: cam.x, y: cam.y, s: cam.s}, b: c, t0: performance.now(),
            dur: clamp(260 + 150 * Math.abs(Math.log(r)) + 0.35 * d, 260, 1100)};
    req();
  }
  function goHome(animate) {
    var c = {x: home.x, y: home.y, s: home.s};
    if (animate) fly(c); else { stop(); set(c); }
  }
  function step(now) {
    if (anim.kind === "fly") {
      var t = clamp((now - anim.t0) / anim.dur, 0, 1), e = ease(t), a = anim.a, b = anim.b;
      var s = a.s * Math.pow(b.s / a.s, e), g = Math.abs(b.s / a.s - 1) < 0.02 ? e : (1 / s - 1 / a.s) / (1 / b.s - 1 / a.s);
      cam = {x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g, s: s};
      if (t >= 1) { cam = b; anim = null; }
    } else {                               // a glide after a drag
      var dt = Math.min(now - anim.t, 50);
      anim.t = now;
      panBy(anim.vx * dt, anim.vy * dt);
      var k = Math.exp(-dt / 325);
      anim.vx *= k;
      anim.vy *= k;
      if (Math.hypot(anim.vx, anim.vy) < 0.02) anim = null;
    }
  }
  function req() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (furnDirty) { furniture(); furnDirty = false; }
    if (anim) step(now);
    satStep(now);
    place();
    if (ready) draw();
    ui();
    if (anim || (sat.st === 2 && sat.f !== (sat.on ? 1 : 0))) req();
  }

  // ---------------------------------------------------------------- data
  function load() {
    fetch(BASE + "coast.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (c) {
      G = {w0: new Path2D(c.water[0]), w1: new Path2D(c.water[1]), sand: new Path2D(c.sand), rock: new Path2D(c.rock)};
      ready = true;
      draw();                              // the same view, now drawn from the data, before the drawn map steps aside
      host.classList.add("on");
      host.tabIndex = 0;
      host.setAttribute("role", "region");
      host.setAttribute("aria-roledescription", "map");
      host.setAttribute("aria-label", D.label);
      host.setAttribute("aria-describedby", D.desc);
      furnDirty = true;
      req();
    }).catch(function () {                 // keep the drawn map
      host.classList.remove("im");
      [cv, ov, ctl, hint, scale].forEach(function (e) { e.remove(); });
    });
  }
  function wantShore() {
    if (aState) return;
    aState = 1;
    var img = new Image();
    Promise.all([
      fetch(BASE + "anglet.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      new Promise(function (ok, no) { img.onload = function () { ok(img); }; img.onerror = no; img.src = BASE + "anglet-fade.webp"; })
    ]).then(function (r) {
      var a = r[0], L = a.layers;
      A = {w: a.frame.w, h: a.frame.h, roads: a.roads.map(function (x) { return [x[0], new Path2D(x[1])]; }),
           paths: new Path2D(a.paths), quais: new Path2D(a.quais), bld: new Path2D(a.bld)};
      ["sea", "wet", "veg", "paved", "inland", "reef", "rock"].forEach(function (k) { A[k] = new Path2D(L[k]); });
      A.dry = new Path2D();                // the frame less its sea: no edge out on the water
      A.dry.rect(0, 0, A.w, A.h);
      A.dry.addPath(A.sea);
      fade = r[1];
      aState = 2;
      req();
    }).catch(function () { aState = -1; });
  }
  function interacted() {
    if (!touched) { touched = true; wantShore(); }
  }

  // ---------------------------------------------------------------- drawing
  function reefFill(c) {
    if (!reef) {
      var q = 8, p = document.createElement("canvas"), x = p.getContext("2d");
      p.width = p.height = 6 * q;
      x.fillStyle = C.mreef;
      x.beginPath();
      x.arc(3 * q, 3 * q, 1.1 * q, 0, 7);
      x.fill();
      reef = c.createPattern(p, "repeat");
      if (reef.setTransform && window.DOMMatrix) reef.setTransform(new DOMMatrix().scale(1 / q));
      else reef = "flat";
    }
    return reef;
  }
  function draw() {
    var s = cam.s, m = [R * s, 0, 0, R * s, R * (W / 2 - s * cam.x), R * (H / 2 - s * cam.y)], k = 1 - sat.f;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (k > 0) {                          // our map, unless Apple's satellite view is showing under it
      ctx.globalAlpha = k;
      ctx.fillStyle = C.mdry;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.fillStyle = C.msea;
      ctx.fill(s < LOD ? G.w0 : G.w1, "evenodd");
      var a = ramp(s, 0.03, 0.06);
      if (a > 0) {                        // the foreshore: sand and rock between the tides
        ctx.globalAlpha = a * k;
        ctx.fillStyle = C.mwet;
        ctx.fill(G.sand, "evenodd");
        ctx.fillStyle = C.mrock;
        ctx.fill(G.rock, "evenodd");
      }
      ctx.globalAlpha = 1;
      if (s >= 0.05) wantShore();
      var x0 = cam.x - W / 2 / s, y0 = cam.y - H / 2 / s, x1 = cam.x + W / 2 / s, y1 = cam.y + H / 2 / s;
      if (aState === 2 && s >= 0.08 && x1 > FBOX[0] && x0 < FBOX[2] && y1 > FBOX[1] && y0 < FBOX[3]) shore(m, k);
    }
    if (s >= 0.6 && root.hasAttribute("data-demo")) peaks(m);
    grid();
  }
  function shore(m, k) {
    var s = cam.s, o = octx, a1 = ramp(s, 0.08, 0.16), a2 = ramp(s, 0.12, 0.22), a3 = ramp(s, 0.14, 0.25), a4 = ramp(s, 0.2, 0.35);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = "source-over";
    o.clearRect(0, 0, off.width, off.height);
    o.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    o.transform(FM[0], FM[1], FM[2], FM[3], FM[4], FM[5]);
    function fill(p, col, al) { o.globalAlpha = al; o.fillStyle = col; o.fill(p, "evenodd"); }
    fill(A.dry, C.mdry, a1);
    fill(A.wet, C.mwet, a1);
    fill(A.veg, C.mveg, a2);
    fill(A.paved, C.mpaved, a2);
    fill(A.inland, C.minland, a1);
    fill(A.sea, C.msea, a1);
    o.save();                              // the waterline, not the frame's own edges
    o.beginPath();
    o.rect(4, 4, A.w - 8, A.h - 8);
    o.clip();
    o.strokeStyle = C.mcoast;
    o.lineWidth = 1;
    o.stroke(A.sea);
    o.restore();
    var rf = s * 3 >= 4 ? reefFill(o) : "flat";   // dots 3 m apart once they are 4 px apart, an even tint before
    if (rf === "flat") fill(A.reef, C.mreef, a1 * 0.11); else fill(A.reef, rf, a1);
    o.globalAlpha = a3;
    o.lineCap = o.lineJoin = "round";
    o.strokeStyle = C.mcasing;
    A.roads.forEach(function (r) { o.lineWidth = r[0] + 1.6; o.stroke(r[1]); });
    o.strokeStyle = C.mroad;
    A.roads.forEach(function (r) { o.lineWidth = r[0]; o.stroke(r[1]); });
    o.setLineDash([3, 3]);
    o.strokeStyle = C.mpath;
    o.lineWidth = 1.2;
    o.stroke(A.paths);
    o.setLineDash([]);
    fill(A.rock, C.mrock, a1);
    o.strokeStyle = C.mrockline;
    o.lineWidth = 0.6;
    o.stroke(A.rock);
    o.lineCap = "butt";
    o.strokeStyle = C.mquaicase;
    o.lineWidth = 7;
    o.stroke(A.quais);
    o.strokeStyle = C.mquai;
    o.lineWidth = 4.5;
    o.stroke(A.quais);
    if (a4 > 0) {
      o.globalAlpha = a4;
      o.save();
      o.translate(3, 3);
      o.fillStyle = C.mshadow;
      o.fill(A.bld);
      o.restore();
      o.fillStyle = C.mbld;
      o.fill(A.bld);
      o.strokeStyle = C.mbldline;
      o.lineWidth = 0.8;
      o.stroke(A.bld);
    }
    o.globalAlpha = 1;
    o.globalCompositeOperation = "destination-in";   // fade out inland and at both ends
    o.imageSmoothingEnabled = true;
    o.drawImage(fade, 0, 0, A.w, A.h);
    o.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
  }
  function peaks(m) {                    // Demo: Les Cavaliers' example peaks, take-off zones and people
    var s = cam.s, a = ramp(s, 0.6, 0.8), k = s / F.ppm;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.transform(FM[0], FM[1], FM[2], FM[3], FM[4], FM[5]);
    ctx.globalAlpha = a;
    PK.forEach(function (p) {
      var x = (p.u - F.u0) * F.ppm, y = (F.v1 - p.v) * F.ppm;
      ctx.beginPath();
      ctx.ellipse(x, y, 44, 20, 0, 0, 7);
      ctx.fillStyle = C.zone;
      ctx.fill();
      ctx.setLineDash(p.lv === 2 ? [5 / k, 5 / k] : []);
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = C.ring;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ring;
      for (var i = 0; i < p.n; i++) {
        var r = Math.sqrt((i + 0.5) / p.n), t = i * 2.39996;
        ctx.beginPath();
        ctx.arc(x + 34 * r * Math.cos(t), y + 13 * r * Math.sin(t), Math.max(4, 2.5 / k), 0, 7);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }
  var STEPS = [0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
  function grid() {
    var s = cam.s, st = STEPS[0], i;
    for (i = 0; i < STEPS.length && STEPS[i] * P.ky * s >= 100; i++) st = STEPS[i];
    var dec = st >= 0.01 ? 2 : 3, a = toLL(cam.x - W / 2 / s, cam.y - H / 2 / s), b = toLL(cam.x + W / 2 / s, cam.y + H / 2 / s);
    var lat = [], lon = [];
    for (i = Math.ceil(b[0] / st); i * st <= a[0]; i++) lat.push(i * st);
    for (i = Math.ceil(a[1] / st); i * st <= b[1]; i++) lon.push(i * st);
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.globalAlpha = sat.on ? 0.16 : 0.05;
    ctx.strokeStyle = C.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var ys = [], xs = [];
    lat.forEach(function (v) {
      var y = (toM(v, P.lon0)[1] - cam.y) * s + H / 2;
      if (y > 2 && y < H - 2) { ctx.moveTo(0, y); ctx.lineTo(W, y); ys.push([v, y]); }
    });
    lon.forEach(function (v) {
      var x = (toM(P.lat0, v)[0] - cam.x) * s + W / 2;
      if (x > 2 && x < W - 2) { ctx.moveTo(x, 0); ctx.lineTo(x, H); xs.push([v, x]); }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ctx.fillStyle = C.mlab;
    ctx.font = "10px " + D.mono;
    if (sat.on) { ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 3 * R; }
    var by = sat.on ? H - 26 : H;
    ctx.textBaseline = "alphabetic";
    var taken = furn.concat(boxes);
    ctx.beginPath();
    ys.forEach(function (q) {
      var t = q[0].toFixed(dec) + "°N", w = ctx.measureText(t).width, bx = [12, q[1] - 8, 30 + w, q[1] + 8];
      if (hit(bx, taken)) return;
      ctx.moveTo(14, q[1]);
      ctx.lineTo(22, q[1]);
      ctx.fillText(t, 26, q[1] + 3.5);
    });
    xs.forEach(function (q) {
      var t = (-q[0]).toFixed(dec) + "°W", w = ctx.measureText(t).width, bx = [q[1] - 2, by - 18, q[1] + 6 + w, by];
      if (hit(bx, taken)) return;
      ctx.moveTo(q[1], by - 8);
      ctx.lineTo(q[1], by);
      ctx.fillText(t, q[1] + 4, by - 6);
    });
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
  function hit(b, list) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- dots and names
  var boxes = [];
  function size(e) {
    if (!e.w) { e.w = e.offsetWidth; e.h = e.offsetHeight; }
    return e;
  }
  function measureAll() { labels.concat([call]).forEach(function (e) { e.w = 0; size(e); }); }
  function put(e, x, y) {
    e.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    e.style.visibility = "";
  }
  function hide(e) { e.style.visibility = "hidden"; }
  function tryLabel(e, x, y, show) {      // x, y: top-left
    size(e);
    var b = [x - 2, y - 1, x + e.w + 2, y + e.h + 1];
    if (!show || b[0] < 0 || b[2] > W || b[1] < 0 || b[3] > H || hit(b, boxes) || hit(b, furn)) { hide(e); return false; }   // whole, or not at all
    boxes.push(b);
    put(e, x, y);
    return true;
  }
  function place() {
    var s = cam.s, demo = root.hasAttribute("data-demo"), t = ramp(s, 0.06, 0.25), nr = s >= 0.3;
    if (nr !== near) {
      near = nr;
      ov.classList.toggle("near", nr);
      measureAll();
    }
    boxes = [];
    B.forEach(function (b) {
      var d = 7 * (1 - t) - 12 * s * t;     // just on the land when far, on the beach (12 m below the high-water line) up close
      b.sx = (b.x - cam.x) * s + W / 2 + b.ux * d;
      b.sy = (b.y - cam.y) * s + H / 2 + b.uy * d;
      b.on = !(b.sx < -20 || b.sx > W + 20 || b.sy < -20 || b.sy > H + 20 || hit([b.sx - 4, b.sy - 4, b.sx + 4, b.sy + 4], furn));
      if (!b.on) { hide(b.dot); return; }
      put(b.dot, b.sx, b.sy);
      boxes.push([b.sx - 6, b.sy - 6, b.sx + 6, b.sy + 6]);
    });
    var ang = B.filter(function (b) { return b.anglet; });
    // Anglet: a bracket when far, then one name for the seven, then each beach
    var ys = ang.map(function (b) { return b.sy; }), xs = ang.map(function (b) { return b.sx; });
    var y1 = Math.min.apply(null, ys), y2 = Math.max.apply(null, ys), bx0 = Math.min.apply(null, xs) - 16;
    if (s < 0.03) {
      brLine.style.height = Math.round(y2 - y1) + "px";
      put(brLine, bx0, y1);
      size(brText);
      tryLabel(brText, bx0 - 8 - brText.w, (y1 + y2) / 2 - brText.h / 2 + 0.5, true);
      boxes.push([bx0 - 1, y1, bx0 + 7, y2]);
    } else { hide(brLine); hide(brText); }
    var mid = ang[Math.floor(ang.length / 2)];
    tryLabel(cluster, mid.sx + 12, mid.sy - size(cluster).h / 2, s >= 0.03 && s < 0.1);
    if (demo && callB && s < 0.03 && W > 640) {
      size(call);
      var cx = callB.sx - 18 - call.w, cy = callB.sy - call.h + 12;   // its pointer near the foot, clear of the next dot south
      put(call, cx, cy);
      boxes.push([cx, cy, cx + call.w + 18, cy + call.h]);
    } else hide(call);
    B.forEach(function (b) {               // right of the dot, else left of it
      var show = b.on && (b.anglet ? s >= 0.1 : s >= 0.035), g = nr ? 10 : 9, y = b.sy - size(b.lab).h / 2;
      if (!tryLabel(b.lab, b.sx + g, y, show) && show) tryLabel(b.lab, b.sx - g - b.lab.w, y, true);
    });
    T.forEach(function (o) {
      size(o.lab);
      tryLabel(o.lab, (o.x - cam.x) * s + W / 2, (o.y - cam.y) * s + H / 2 - o.lab.h * 0.8, s < 0.3);
    });
    PL.forEach(function (o) {
      size(o.lab);
      tryLabel(o.lab, (o.x - cam.x) * s + W / 2 - o.lab.w / 2, (o.y - cam.y) * s + H / 2 - o.lab.h / 2, s >= 0.25);
    });
    PK.forEach(function (p) {
      if (!(demo && s >= 0.6)) { hide(p.el); return; }
      var m = uvToM(p.u, p.v), x = (m[0] - cam.x) * s + W / 2, y = (m[1] - cam.y) * s + H / 2 - 10 * s;
      if (x < -60 || x > W + 60 || y < -20 || y > H + 60) { hide(p.el); return; }
      put(p.el, x, y);
      p.el.style.opacity = ramp(s, 0.6, 0.8);
    });
  }
  function states() {
    var demo = root.hasAttribute("data-demo");
    B.forEach(function (b) {
      var st = demo ? b.st : "wait";
      b.dot.innerHTML = '<svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden="true">' +
        (demo && b.slug === DM.sel ? SEL : "") + DOTS[st] + "</svg>";
      b.dot.setAttribute("aria-label", b.name + ", " + b.town + ". " + D.words[st]);
    });
    brText.textContent = demo ? DM.anglet : D.anglet[0];
    brText.w = 0;
    req();
  }
  function ui() {
    var h = atHome(), a = cam.s > home.s * 1.02 || sat.on || (satCard !== null && !satCard.hidden);
    homeBtn.hidden = h || !ready;
    if (a !== away) {                      // the info card steps aside while the map is zoomed in, and comes back
      away = a;
      box.classList.toggle("away", a);
      furnDirty = true;
      req();
    }
    if (pill) {
      var t = D.pill;
      if (!h) {
        var ll = toLL(cam.x, cam.y), dec = cam.s < 0.05 ? 2 : cam.s < 0.5 ? 3 : 4, best = null, bd = 1e9;
        t = ll[0].toFixed(dec) + "° N " + (-ll[1]).toFixed(dec) + "° W";
        B.forEach(function (b) { var d = Math.hypot(b.x - cam.x, b.y - cam.y); if (d < bd) { bd = d; best = b; } });
        if (cam.s >= 0.08 && bd < 500) t = best.name + " · " + t;
      }
      if (t !== pillLast) { pillLast = t; pill.textContent = t; furnDirty = true; req(); }
    }
    if (h) { scale.hidden = true; return; }
    var L = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5].filter(function (v) { return v * cam.s <= 96; })[0] || 5;
    scale.hidden = false;
    scale.firstChild.style.width = Math.round(L * cam.s) + "px";
    scale.lastChild.textContent = L >= 1000 ? L / 1000 + " km" : L + " m";
  }

  // ---------------------------------------------------------------- hands, mouse and keys
  var hintT = 0;
  function showHint(t, ms) {
    hint.textContent = t;
    hint.classList.add("on");
    clearTimeout(hintT);
    hintT = setTimeout(function () { hint.classList.remove("on"); }, ms || 1300);
  }
  function rel(e) { var r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  var SKIP = ".imctl,.lgm,.mfoot,.mcred,.mcap,.imcall,.imsatcard,.imsat";   // .imsat: Apple's logo and Legal link
  host.addEventListener("wheel", function (e) {
    if (!ready || e.target.closest(".imsatcard")) return;
    if (!e.ctrlKey && !e.metaKey) { showHint(MAC ? D.hints[0] : D.hints[1]); return; }
    e.preventDefault();
    interacted();
    var d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode ? e.deltaY * 600 : e.deltaY;
    var k = e.ctrlKey && !e.metaKey && Math.abs(d) < 50 ? -d * 0.02 : -d * 0.002;   // a pinch on a trackpad, or a wheel
    var p = rel(e);
    zoomAt(p[0], p[1], Math.exp(clamp(k, -0.7, 0.7)), false);
  }, {passive: false});
  var g = null, touchOn = false;
  host.addEventListener("gesturestart", function (e) {
    if (!ready) return;
    e.preventDefault();
    if (touchOn) return;
    stop();
    interacted();
    g = 1;
  });
  host.addEventListener("gesturechange", function (e) {
    if (!ready || g === null) return;
    e.preventDefault();
    if (touchOn) return;
    var p = rel(e);
    zoomAt(p[0], p[1], e.scale / g, false);
    g = e.scale;
  });
  host.addEventListener("gestureend", function (e) { if (g !== null) { e.preventDefault(); g = null; } });

  var drag = null, noClick = false;
  host.addEventListener("pointerdown", function (e) {
    if (!ready || e.pointerType === "touch" || e.button !== 0 || e.target.closest(SKIP)) return;
    drag = {id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, v: []};
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 4) return;
      drag.moved = true;
      stop();
      interacted();
      host.classList.add("drag");
    }
    panBy(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.v.push([performance.now(), e.clientX, e.clientY]);
    if (drag.v.length > 5) drag.v.shift();
  });
  function dragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    host.classList.remove("drag");
    if (!d.moved) return;
    noClick = true;
    setTimeout(function () { noClick = false; }, 0);
    var a = d.v[0], b = d.v[d.v.length - 1];
    if (motion.matches || !a || b[0] - a[0] <= 0 || performance.now() - b[0] > 80) return;
    var vx = (b[1] - a[1]) / (b[0] - a[0]), vy = (b[2] - a[2]) / (b[0] - a[0]);
    if (Math.hypot(vx, vy) < 0.25) return;
    anim = {kind: "glide", vx: vx, vy: vy, t: performance.now()};
    req();
  }
  window.addEventListener("pointerup", dragEnd);
  window.addEventListener("pointercancel", dragEnd);
  host.addEventListener("dblclick", function (e) {
    if (!ready || e.target.closest(SKIP)) return;
    e.preventDefault();
    interacted();
    var p = rel(e);
    zoomAt(p[0], p[1], e.shiftKey ? 0.5 : 2, true);
  });

  var tp = null, tap = null, lastTap = null;
  host.addEventListener("touchstart", function (e) {
    if (!ready) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      stop();
      interacted();
      touchOn = true;
      tap = null;
      var a = e.touches[0], b = e.touches[1], r = host.getBoundingClientRect();
      var mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top;
      tp = {d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s: cam.s, r: r,
            wx: cam.x + (mx - W / 2) / cam.s, wy: cam.y + (my - H / 2) / cam.s};
    } else if (e.touches.length === 1 && !tp) {
      tap = e.target.closest(SKIP) ? null : {x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false};
    }
  }, {passive: false});
  host.addEventListener("touchmove", function (e) {
    if (!ready) return;
    if (tp && e.touches.length === 2) {
      e.preventDefault();
      var a = e.touches[0], b = e.touches[1], r = tp.r;
      var mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top;
      var s = clamp(tp.s * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1) / tp.d, home.s, SMAX);
      if (s > SREG && tp.s <= SREG + 1e-9 && !sat.on && !inFrame(tp.wx, tp.wy)) s = SREG;
      set({x: tp.wx - (mx - W / 2) / s, y: tp.wy - (my - H / 2) / s, s: s});
    } else if (tap && e.touches.length === 1 && !tap.moved) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - tap.x) + Math.abs(t.clientY - tap.y) > 10) {
        tap.moved = true;
        showHint(D.hints[2]);
      }
    }
  }, {passive: false});
  host.addEventListener("touchend", function (e) {
    if (!ready) return;
    if (e.touches.length < 2) tp = null;
    if (e.touches.length) return;
    touchOn = false;
    if (!tap || tap.moved) { tap = null; return; }
    var now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.abs(tap.x - lastTap.x) + Math.abs(tap.y - lastTap.y) < 30) {
      e.preventDefault();
      interacted();
      var r = host.getBoundingClientRect();
      zoomAt(tap.x - r.left, tap.y - r.top, 2, true);
      lastTap = null;
    } else lastTap = {t: now, x: tap.x, y: tap.y};
    tap = null;
  });
  host.addEventListener("touchcancel", function () { tp = null; tap = null; touchOn = false; });

  host.addEventListener("keydown", function (e) {
    if (!ready || e.target !== host || e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key;
    if (k === "ArrowLeft") panBy(80, 0);
    else if (k === "ArrowRight") panBy(-80, 0);
    else if (k === "ArrowUp") panBy(0, 80);
    else if (k === "ArrowDown") panBy(0, -80);
    else if (k === "+" || k === "=") zoomAt(W / 2, H / 2, 2, true);
    else if (k === "-" || k === "_") zoomAt(W / 2, H / 2, 0.5, true);
    else if (k === "0") goHome(true);
    else return;
    e.preventDefault();
    interacted();
  });
  ctl.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || !ready) return;
    interacted();
    if (b === satBtn) {
      if (sat.on) satOff(); else if (satAsked()) satOn(); else satAsk();
      return;
    }
    if (b === satOnly) {
      try { localStorage.removeItem(SAT_KEY); } catch (err) { /* nothing stored */ }
      satOff();
      satBtn.focus({preventScroll: true});
      return;
    }
    var z = b.getAttribute("data-z");
    if (z === "home") { goHome(true); host.focus({preventScroll: true}); } else zoomAt(W / 2, H / 2, z === "in" ? 2 : 0.5, true);
  });
  ov.addEventListener("click", function (e) {
    var d = e.target.closest(".imk");
    if (!d || noClick || !ready || anim) return;
    var b = B.filter(function (x) { return x.dot === d; })[0];
    interacted();
    var grp = [b], i;                      // dots too close to pick one: open their group up first
    for (i = 0; i < grp.length; i++) {
      B.forEach(function (x) { if (x.on && grp.indexOf(x) < 0 && Math.hypot(x.sx - grp[i].sx, x.sy - grp[i].sy) < 24) grp.push(x); });
    }
    if (grp.length > 1) {
      var xs = grp.map(function (x) { return x.x; }), ys = grp.map(function (x) { return x.y; });
      var gx0 = Math.min.apply(null, xs), gx1 = Math.max.apply(null, xs), gy0 = Math.min.apply(null, ys), gy1 = Math.max.apply(null, ys);
      var fit = Math.min(W * 0.8 / Math.max(gx1 - gx0, 100), H * 0.8 / Math.max(gy1 - gy0, 100)), sep = Infinity;
      grp.forEach(function (p, j) { for (var k = j + 1; k < grp.length; k++) sep = Math.min(sep, Math.hypot(p.x - grp[k].x, p.y - grp[k].y)); });
      var want = 32 / sep;                 // the closest two about 32 px apart, and Anglet's names showing
      if (grp.every(function (x) { return x.anglet; })) want = Math.max(want, 0.1);
      var gs = clamp(Math.min(fit, want), cam.s * 1.5, 0.2);
      fly({x: (gx0 + gx1) / 2, y: (gy0 + gy1) / 2, s: gs});
      return;
    }
    // fly to the beach (close enough for its peaks where Demo has some), or open its page once there
    var close = !inFrame(b.x, b.y) ? (sat.on ? 0.45 : 0.12) : root.hasAttribute("data-demo") && b.slug === DM.peaksAt ? 0.9 : 0.45;
    var cx = b.x - b.ux * 40, cy = b.y - b.uy * 40;
    if (cam.s < close * 0.7 || Math.hypot(cx - cam.x, cy - cam.y) * cam.s > Math.min(W, H) / 3) fly({x: cx, y: cy, s: Math.max(close, cam.s)});
    else if (b.href) window.location.href = b.href;
  });

  // ---------------------------------------------------------------- Apple's satellite view, loaded only when asked for
  // Nothing goes to Apple until someone picks it on the card; the pick stays in this browser. Our map fades out over
  // Apple's, which follows our camera; the dots, names, peaks and grid stay ours.
  var SAT_KEY = "obsurf.satellite";        // only a yes is kept; "Not now" asks again next time
  function satAsked() { try { return localStorage.getItem(SAT_KEY) === "yes"; } catch (e) { return false; } }
  function satAsk() {
    if (!satCard) {
      satCard = document.createElement("div");
      satCard.className = "imsatcard";
      satCard.tabIndex = -1;
      satCard.setAttribute("role", "dialog");
      satCard.setAttribute("aria-labelledby", "imsat-t");
      satCard.setAttribute("aria-describedby", "imsat-d");
      satCard.innerHTML = '<b id="imsat-t"></b><p id="imsat-d"></p><small></small> <a></a>' +
        '<div class="row"><button type="button" data-s="ok"></button><button type="button" data-s="no"></button></div>';
      satCard.querySelector("b").textContent = SAT.title;
      satCard.querySelector("p").textContent = SAT.card;
      satCard.querySelector("small").textContent = SAT.small;
      satCard.querySelector("a").textContent = SAT.link;
      satCard.querySelector("a").href = SAT.href;
      satCard.querySelector("[data-s=ok]").textContent = SAT.ok;
      satCard.querySelector("[data-s=no]").textContent = SAT.no;
      satCard.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        satClose();
        if (b.getAttribute("data-s") !== "ok") return;
        try { localStorage.setItem(SAT_KEY, "yes"); } catch (err) { /* asked again next time */ }
        satOn();
      });
      satCard.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); satClose(); } });
      host.appendChild(satCard);
    }
    satCard.hidden = false;
    satCard.focus({preventScroll: true});
    req();                                  // the info card steps aside while this one asks   // the card, not a button: neither answer is picked for you
  }
  function satClose() {
    if (!satCard || satCard.hidden) return;
    satCard.hidden = true;
    satBtn.focus({preventScroll: true});
    req();
  }
  function satOn() {
    satLive.textContent = "";
    if (sat.bad) { satSays(); return; }
    sat.on = true;
    satBtn.setAttribute("aria-pressed", "true");
    satOnly.hidden = false;
    host.classList.add("sat");
    colours();
    furnDirty = true;
    if (sat.st === 2) { sat.t = performance.now(); sat.last = ""; req(); return; }
    if (sat.st === 1) return;
    sat.st = 1;
    satBtn.classList.add("busy");
    sat.timer = setTimeout(satFail, 15000);
    if (window.mapkit) { satInit(); return; }
    var sc = document.createElement("script");
    sc.src = SAT.src;
    sc.crossOrigin = "anonymous";
    sc.async = true;
    sc.addEventListener("load", satInit, {once: true});
    sc.addEventListener("error", function () { sc.remove(); satFail(); }, {once: true});
    document.head.appendChild(sc);
  }
  function satInit() {
    var M = window.mapkit;
    if (sat.st !== 1) return;
    if (!M || !M.load) { satFail(); return; }
    if (!sat.init) {
      sat.init = true;
      M.addEventListener("error", function () { sat.bad = true; satFail(); });
      M.init({authorizationCallback: function (done) { done(SAT.token); }, language: "en"});
    }
    M.load(["map"]).then(satMake, satFail);
  }
  function satMake() {
    var M = window.mapkit;
    if (sat.st !== 1) return;
    try {
      sat.el = document.createElement("div");
      sat.el.className = "imsat";
      sat.el.setAttribute("aria-hidden", "true");
      cv.parentNode.insertBefore(sat.el, cv);
      sat.map = new M.Map(sat.el, {
        mapType: (M.MapType || M.Map.MapTypes).Satellite, region: satRegion(), isRotationEnabled: false, isScrollEnabled: false,
        isZoomEnabled: false, showsCompass: M.FeatureVisibility.Hidden, showsScale: M.FeatureVisibility.Hidden,
        showsMapTypeControl: false, showsZoomControl: false, showsUserLocationControl: false, showsPointsOfInterest: false
      });
    } catch (e) {
      if (sat.el) sat.el.remove();
      sat.el = sat.map = null;
      satFail();
      return;
    }
    clearTimeout(sat.timer);
    sat.st = 2;
    satBtn.classList.remove("busy");
    sat.wait = performance.now() + 400;  // the first photos come in under our map before it fades
    sat.t = 0;
    req();
  }
  function satFail() {                    // while loading, or after: Apple's map goes, ours comes back
    if (sat.st === 0) return;
    clearTimeout(sat.timer);
    if (sat.el) sat.el.remove();
    sat.el = sat.map = null;
    sat.st = 0;
    sat.f = 0;
    satBtn.classList.remove("busy");
    if (sat.on) satOff(); else req();
    satSays();
  }
  function satSays() {
    showHint(SAT.error, 3500);
    satLive.textContent = SAT.error;
  }
  function satOff() {
    sat.on = false;
    satBtn.setAttribute("aria-pressed", "false");
    satOnly.hidden = true;
    host.classList.remove("sat");
    colours();
    furnDirty = true;
    sat.t = performance.now();
    var c = clampCam({x: cam.x, y: cam.y, s: cam.s});   // back inside our map's own limits
    if (Math.abs(c.s - cam.s) > 1e-9 || Math.abs(c.x - cam.x) > 0.01 || Math.abs(c.y - cam.y) > 0.01) fly(c); else req();
  }
  function satRegion() {
    var M = window.mapkit, c = toLL(cam.x, cam.y);
    return new M.CoordinateRegion(new M.Coordinate(c[0], c[1]), new M.CoordinateSpan(H / cam.s / P.ky, W / cam.s / P.kx));
  }
  function satStep(now) {
    if (sat.st !== 2) return;
    var goal = sat.on ? 1 : 0;
    if (sat.f !== goal && now >= sat.wait) {
      if (!sat.t) sat.t = now;
      sat.f = motion.matches ? goal : clamp(sat.f + (goal ? 1 : -1) * (now - sat.t) / 300, 0, 1);
      sat.t = now;
    }
    sat.el.style.visibility = sat.f > 0 || sat.on ? "" : "hidden";
    if (!sat.on && sat.f === 0) return;
    var key = [cam.x.toFixed(1), cam.y.toFixed(1), cam.s.toPrecision(6), W, H].join();
    if (key === sat.last) return;
    sat.last = key;
    sat.map.setRegionAnimated(satRegion(), false);
  }

  // ---------------------------------------------------------------- start
  function resize() {
    var h = atHome() || !ready;
    measure();
    if (h) cam = {x: home.x, y: home.y, s: home.s}; else cam = clampCam(cam);
    furnDirty = true;
    measureAll();
    req();
  }
  host.classList.add("im");                 // dots and names from here on: the drawn map's own hide
  measure();
  cam = {x: home.x, y: home.y, s: home.s};
  colours();
  states();
  furniture();
  measureAll();
  frame(performance.now());
  load();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
  window.addEventListener("resize", resize);
  new MutationObserver(states).observe(root, {attributes: true, attributeFilter: ["data-demo"]});
  var dark = window.matchMedia("(prefers-color-scheme: dark)"), recolour = function () { colours(); req(); };
  if (dark.addEventListener) dark.addEventListener("change", recolour); else if (dark.addListener) dark.addListener(recolour);
})();
