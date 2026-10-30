(function () {
  "use strict";
  // The coast map, made zoomable: the same view as the drawing first, then the coast from the map data and, closer in,
  // the Anglet shore in the beach plans' look (tools/coast_map). Everything comes from this site.
  var host = document.querySelector("[data-imap]"), dataEl = document.getElementById("imap-data");
  if (!host || !dataEl || !window.Path2D || !window.fetch || !window.requestAnimationFrame) return;
  var cv = document.createElement("canvas"), ctx = cv.getContext && cv.getContext("2d");
  if (!ctx) return;
  var off = document.createElement("canvas"), octx = off.getContext("2d");
  var tv = document.createElement("canvas"), tctx = tv.getContext("2d");   // the edge marks, over the glass
  var D = JSON.parse(dataEl.textContent), P = D.proj, DOM = D.domain, F = D.frame, BASE = host.getAttribute("data-imap");
  // Demo's example states, note and peaks wait in a template, like the site's other demo blocks
  var DM = {states: {}, sel: "", anglet: "", callout: null}, dmEl = document.getElementById("imap-demo");
  var dmScript = dmEl && dmEl.content && dmEl.content.querySelector("script");
  if (dmScript) DM = JSON.parse(dmScript.textContent);
  var root = document.documentElement, motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  var MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  var SREG = 0.35, SMAX = 3, LOD = 0.035;    // px a metre: most zoom away from Anglet, most at Anglet, finer coast from
  // The beach page (data-spot): the same map turned to look out to sea, the shore across and the sea at the top. It keeps
  // to Anglet's shore and tells the page which beach is in view (imap:beach), so the figures below can follow.
  var SP = D.spot || null, ROT = 0, RC = 1, RS = 0, cur = "", lock = "", RAIL = null;

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
  if (SP) {                                 // turned so the frame's u runs to the right and v, out to sea, up
    ROT = Math.atan2(AY * CB, AX * SB);
    RC = Math.cos(ROT);
    RS = Math.sin(ROT);
    SP.m = {};
    Object.keys(SP.centres).forEach(function (k) { SP.m[k] = uvToM(SP.centres[k][0], SP.centres[k][1]); });
    RAIL = Object.keys(SP.centres).map(function (k) { return SP.centres[k]; }).sort(function (a, b) { return a[0] - b[0]; });
    var hash = (location.hash || "").slice(1);
    cur = SP.m[hash] ? hash : SP.start;
  }

  // ---------------------------------------------------------------- the page's parts
  var mk = host.querySelector(".mmk"), pill = host.querySelector(".mcap"), foot = host.querySelector(".mfoot");
  var FURN = host.getAttribute("data-furn");   // the page's own things over the map (the beach page's header and title)
  var cred = host.querySelector(".mcred");
  var box = host.parentNode, legend = host.querySelector(".lgm"), card = box.querySelector(".bcard");
  cv.className = "imc";
  cv.setAttribute("aria-hidden", "true");
  var ov = document.createElement("div");
  ov.className = "imo";
  var glass = document.createElement("div");   // frosted edges over the drawing (Leo, 30 Oct 2026), under the marks and names
  glass.className = "imgl";
  glass.setAttribute("aria-hidden", "true");
  glass.innerHTML = ["t", "b", "l", "r"].map(function (k) { return '<i class="' + k + '"><b></b><b></b><b></b></i>'; }).join("");
  tv.className = "imc imt";
  tv.setAttribute("aria-hidden", "true");
  var pane = document.createElement("div");    // the drawing and its glass: all the glass blurs, so no page shows in a corner
  pane.className = "impane";
  pane.append(cv, glass);
  (mk.nextElementSibling || mk).after(pane, tv, ov);
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
  var PKS = null, pkState = 0;              // Demo's peaks, from map/peaks.json once Demo is on and the map is close in
  var labels = [brText, cluster].concat(B.map(function (b) { return b.lab; }), T.map(function (t) { return t.lab; }),
                                        PL.map(function (t) { return t.lab; }));
  var callB = DM.callout && B.filter(function (b) { return b.slug === DM.callout.slug; })[0];

  // ---------------------------------------------------------------- state
  var W = 1, H = 1, R = 1, home = {x: 0, y: 0, s: 1}, cam = {x: 0, y: 0, s: 1}, zmin = 1, ready = false, raf = 0, anim = null;
  var G = null, A = null, fade = null, aState = 0, C = {}, reef = null, furn = [], furnDirty = true, near = null, pillLast = "";
  var touched = false, away = false;    // away: zoomed in, when the info card on a wide map steps aside
  // the satellite view: st 0 not loaded, 1 loading, 2 ready; f fades Apple's map in (1) and out (0) under ours
  // bad: Apple refused or failed once on this page (a wrong token, say), so later taps say so straight away
  var sat = {on: false, st: 0, map: null, el: null, f: 0, t: 0, init: false, last: "", timer: 0, wait: 0, bad: false, k: 0};
  var SAT_TURN = ROT * 180 / Math.PI;         // Apple's map turned to match: MapKit turns it clockwise, as ours is

  function measure() {
    var r = host.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    R = Math.min(window.devicePixelRatio || 1, 3);
    var bw = Math.round(W * R), bh = Math.round(H * R);
    if (cv.width !== bw || cv.height !== bh) { cv.width = off.width = tv.width = bw; cv.height = off.height = tv.height = bh; }
    // the drawn map: viewBox 0 0 900 620, xMinYMid slice; vb = [x0, units a metre east, y0, units a metre south]
    var k = Math.max(W / 900, H / 620), vb = D.vb;
    home = {x: (W / (2 * k) - vb[0]) / vb[1], y: (310 - vb[2]) / vb[3], s: k * (vb[1] + vb[3]) / 2};
    zmin = home.s;
    if (SP) { home = spotView(cur); zmin = clamp(W / 7000, 0.04, 0.3); }
  }
  function spotView(slug) {                // the beach page's view of a beach: its peaks across the middle
    var m = SP.m[slug];
    return {x: m[0], y: m[1], s: clamp(W / 640, 0.8, 2.4)};
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
    var list = [legend, pill, foot, cred, ctl, away ? null : card];
    if (FURN) list = list.concat(Array.prototype.slice.call(document.querySelectorAll(FURN)));
    list.forEach(function (e) {
      if (!e) return;
      var r = e.getBoundingClientRect();
      if (r.width && r.height && r.right > r0.left && r.left < r0.right && r.bottom > r0.top && r.top < r0.bottom) {
        furn.push([r.left - r0.left - 6, r.top - r0.top - 6, r.right - r0.left + 6, r.bottom - r0.top + 6]);
      }
    });
    if (sat.on) furn.push([0, H - 34, 130, H], [W - 100, H - 32, W, H]);   // Apple's logo and Legal link
  }

  // ---------------------------------------------------------------- the camera
  // world metres to the screen and back, turned by ROT on the beach page
  function w2s(x, y) {
    var dx = x - cam.x, dy = y - cam.y;
    return [cam.s * (RC * dx - RS * dy) + W / 2, cam.s * (RS * dx + RC * dy) + H / 2];
  }
  function s2w(px, py) {
    var dx = (px - W / 2) / cam.s, dy = (py - H / 2) / cam.s;
    return [cam.x + RC * dx + RS * dy, cam.y - RS * dx + RC * dy];
  }
  function at(wx, wy, px, py, s) {         // the camera that puts the world point wx, wy at the screen point px, py
    var dx = (px - W / 2) / s, dy = (py - H / 2) / s;
    return {x: wx - RC * dx - RS * dy, y: wy + RS * dx - RC * dy, s: s};
  }
  function viewBox() {                     // the part of the world on the screen, as a box
    var a = s2w(0, 0), b = s2w(W, 0), c = s2w(W, H), d = s2w(0, H);
    return [Math.min(a[0], b[0], c[0], d[0]), Math.min(a[1], b[1], c[1], d[1]),
            Math.max(a[0], b[0], c[0], d[0]), Math.max(a[1], b[1], c[1], d[1])];
  }
  function clampCam(c) {
    c.s = clamp(c.s, zmin, SMAX);
    if (SP) {                              // the beach page keeps to Anglet's shore
      var p = mToUv(c.x, c.y), pu = clamp(p[0], F.u0 + 150, F.u1 - 150), pv = clamp(p[1], -300, 700);
      if (pu !== p[0] || pv !== p[1]) { var n = uvToM(pu, pv); c.x = n[0]; c.y = n[1]; }
      return c;
    }
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
    var w = s2w(px, py), s = clamp(cam.s * f, zmin, SMAX);
    if (!SP && s > SREG && cam.s <= SREG + 1e-9 && !sat.on && !inFrame(w[0], w[1])) s = Math.max(cam.s, SREG);
    return clampCam(at(w[0], w[1], px, py, s));
  }
  function zoomAt(px, py, f, animate) {
    var c = zoomTarget(px, py, f);
    if (animate) fly(c); else { stop(); set(c); }
  }
  function panBy(dx, dy) {
    var c = {x: cam.x - (RC * dx + RS * dy) / cam.s, y: cam.y - (RC * dy - RS * dx) / cam.s, s: cam.s};
    if (SP) {                              // along the shore, the view rises and falls with it (Anglet's south lies further out)
      var a = mToUv(cam.x, cam.y), b = mToUv(c.x, c.y), n = uvToM(b[0], b[1] + railV(b[0]) - railV(a[0]));
      c.x = n[0];
      c.y = n[1];
    }
    set(c);
  }
  function railV(u) {                      // the shore's line through the beaches' middles, level at each
    if (u <= RAIL[0][0]) return RAIL[0][1];
    for (var i = 1; i < RAIL.length; i++) {
      if (u <= RAIL[i][0]) {
        var a = RAIL[i - 1], b = RAIL[i], t = (u - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t * t * (3 - 2 * t);
      }
    }
    return RAIL[RAIL.length - 1][1];
  }
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
  // the beach page: which beach is in view, the one nearest the middle, kept until another is clearly nearer
  function bname(slug) {
    for (var i = 0; i < B.length; i++) if (B[i].slug === slug) return B[i].name;
    return "";
  }
  function setBeach(slug) {
    home = spotView(slug);
    homeBtn.textContent = bname(slug);
    host.setAttribute("data-beach", slug);
    if (slug === cur) return;
    cur = slug;
    host.dispatchEvent(new CustomEvent("imap:beach", {detail: {slug: slug}}));
  }
  function goBeach(slug) {
    lock = slug;                           // straight there: no beach on the way takes over the page
    setBeach(slug);
    fly(spotView(slug));
  }
  function inView() {
    if (anim && lock) return;
    lock = "";
    if (cam.s < 0.12) return;
    var best = cur, bd = Infinity, cd = Infinity;
    Object.keys(SP.m).forEach(function (k) {
      var d = Math.hypot(SP.m[k][0] - cam.x, SP.m[k][1] - cam.y);
      if (d < bd) { bd = d; best = k; }
      if (k === cur) cd = d;
    });
    if (best !== cur && bd < cd * 0.85) setBeach(best);
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
    if (SP && ready) inView();
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
      [pane, tv, ov, ctl, hint, scale].forEach(function (e) { e.remove(); });
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
    var s = cam.s, k = 1 - sat.f;
    var m = [R * s * RC, R * s * RS, -R * s * RS, R * s * RC, R * (W / 2 - s * (RC * cam.x - RS * cam.y)), R * (H / 2 - s * (RS * cam.x + RC * cam.y))];
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
      var vb = viewBox();
      if (aState === 2 && s >= 0.08 && vb[2] > FBOX[0] && vb[0] < FBOX[2] && vb[3] > FBOX[1] && vb[1] < FBOX[3]) shore(m, k);
    }
    if (root.hasAttribute("data-demo")) peaks();
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
  // Demo's peaks (map/peaks.json, the same made-up lineups the beach page lists): each peak's take-off zone as three
  // hairline contours, a small open triangle at the peak, the people as dots, and its best rides of the last hour as
  // faint lines, white at the take-off and turning through the ride colours with the seconds ridden.
  function wantPeaks() {
    if (pkState) return;
    pkState = 1;
    fetch(BASE + D.peaks).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (list) {
      PKS = list.map(function (p) {        // [beach, name, u, v, range, face, zone rings, people, rides]
        var w = el("div", "impk"), m = uvToM(p[2], p[3]);
        w.innerHTML = '<span class="chip"><span></span>' + D.faces[p[5]] + "</span>";
        w.firstChild.firstChild.textContent = p[1] + " · " + p[4];
        hide(w);
        return {slug: p[0], x: m[0], y: m[1], lv: p[5], el: w, chip: w.firstChild, rings: p[6].map(flat), ppl: flat(p[7]),
                rides: p[8].map(function (r) { return {t: r[0], p: flat(r[1])}; })};
      });
      pkState = 2;
      req();
    }).catch(function () { pkState = -1; });
  }
  function flat(a) {                       // [u, v, u, v, ...] in the Anglet frame, to map metres
    var out = [];
    for (var i = 0; i + 1 < a.length; i += 2) out.push(uvToM(a[i], a[i + 1]));
    return out;
  }
  function peaks() {
    var s = cam.s, a = ramp(s, 0.45, 0.6);
    if (a <= 0) return;
    if (!PKS) { wantPeaks(); return; }
    var vb = viewBox(), pad = 200, lut = sat.on || dark.matches ? D.ride.d : D.ride.l, n = lut.length - 1;
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.lineJoin = "round";
    PKS.forEach(function (p) {
      if (p.x < vb[0] - pad || p.x > vb[2] + pad || p.y < vb[1] - pad || p.y > vb[3] + pad) return;
      ctx.lineCap = "butt";                // the rides first, thin and faint, a colour for each half second
      ctx.lineWidth = Math.max(1, Math.min(1.5, 0.6 + 0.4 * s));
      ctx.globalAlpha = a * 0.58;
      p.rides.forEach(function (r) {
        var q = r.p, o = w2s(q[0][0], q[0][1]), c = -1;
        for (var i = 1; i < q.length; i++) {
          var k = Math.min(n, Math.round(Math.min((i - 0.5) * 0.25, r.t) / D.ride.dt)), e = w2s(q[i][0], q[i][1]);
          if (k !== c) {
            if (c >= 0) ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = lut[k];
            ctx.moveTo(o[0], o[1]);
            c = k;
          }
          ctx.lineTo(e[0], e[1]);
          o = e;
        }
        if (c >= 0) ctx.stroke();
      });
      ctx.lineCap = "round";               // the take-off zone, the outer line dashed where it's only a rough idea
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.ring;
      p.rings.forEach(function (ring, j) {
        ctx.globalAlpha = a * [0.3, 0.4, 0.55][j];
        ctx.setLineDash(j === 0 && p.lv === 2 ? [3, 3] : []);
        ctx.beginPath();
        ring.forEach(function (q, i) { var o = w2s(q[0], q[1]); if (i) ctx.lineTo(o[0], o[1]); else ctx.moveTo(o[0], o[1]); });
        ctx.closePath();
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = a * 0.9;           // the people
      ctx.fillStyle = C.ring;
      var r = clamp(1.2 + s * 0.7, 1.8, 2.8);
      p.ppl.forEach(function (q) { var o = w2s(q[0], q[1]); ctx.beginPath(); ctx.arc(o[0], o[1], r, 0, 7); ctx.fill(); });
      var o = w2s(p.x, p.y);               // the peak: a small open triangle, a summit on its contours
      ctx.globalAlpha = a;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(o[0], o[1] - 4.5);
      ctx.lineTo(o[0] + 4, o[1] + 2.5);
      ctx.lineTo(o[0] - 4, o[1] + 2.5);
      ctx.closePath();
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
  var STEPS = [0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
  function grid() {
    var s = cam.s, st = STEPS[0], i, vb = viewBox();
    for (i = 0; i < STEPS.length && STEPS[i] * P.ky * s >= 100; i++) st = STEPS[i];
    var dec = st >= 0.01 ? 2 : 3, a = toLL(vb[0], vb[1]), b = toLL(vb[2], vb[3]), by = sat.on ? H - 26 : H;
    var lat = [], lon = [], marks = [];
    for (i = Math.ceil(b[0] / st); i * st <= a[0]; i++) lat.push(i * st);
    for (i = Math.ceil(a[1] / st); i * st <= b[1]; i++) lon.push(i * st);
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.globalAlpha = sat.on ? 0.16 : 0.05;
    ctx.strokeStyle = C.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // each line labelled where it leaves the map: latitudes on the left (on the beach page, turned, at the foot) and
    // longitudes at the foot (on the beach page on the right)
    lat.forEach(function (v) {
      var y = toM(v, P.lon0)[1], p = w2s(vb[0] - 1, y), q = w2s(vb[2] + 1, y), e = SP ? edge(p, q, 1, by) : edge(p, q, 0, 0);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      if (e) marks.push([v.toFixed(dec) + "°N", e, SP ? "b" : "l"]);
    });
    lon.forEach(function (v) {
      var x = toM(P.lat0, v)[0], p = w2s(x, vb[1] - 1), q = w2s(x, vb[3] + 1), e = SP ? edge(p, q, 0, W) : edge(p, q, 1, by);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      if (e) marks.push([(-v).toFixed(dec) + "°W", e, SP ? "r" : "b"]);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    var c = tctx;                          // the marks and their degrees stay sharp over the frosted edges
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, tv.width, tv.height);
    c.setTransform(R, 0, 0, R, 0, 0);
    c.strokeStyle = c.fillStyle = C.mlab;
    c.lineWidth = 1;
    c.font = "10px " + D.mono;
    c.shadowColor = sat.on ? "rgba(0,0,0,0.7)" : "transparent";
    c.shadowBlur = sat.on ? 3 * R : 0;
    c.textBaseline = "alphabetic";
    var taken = furn.concat(boxes);
    c.beginPath();
    marks.forEach(function (k) {
      var t = k[0], w = c.measureText(t).width, x = k[1][0], y = k[1][1];
      var bx = k[2] === "l" ? [12, y - 8, 30 + w, y + 8] : k[2] === "r" ? [W - 30 - w, y - 8, W - 12, y + 8] : [x - 2, by - 18, x + 6 + w, by];
      if (hit(bx, taken)) return;
      if (k[2] === "l") { c.moveTo(14, y); c.lineTo(22, y); c.fillText(t, 26, y + 3.5); }
      else if (k[2] === "r") { c.moveTo(W - 22, y); c.lineTo(W - 14, y); c.fillText(t, W - 26 - w, y + 3.5); }
      else { c.moveTo(x, by - 8); c.lineTo(x, by); c.fillText(t, x + 4, by - 6); }
    });
    c.stroke();
  }
  function edge(p, q, k, c) {              // where the line p-q meets x = c (k 0) or y = c (k 1), if that's on the map
    var d = q[k] - p[k];
    if (Math.abs(d) < 1e-9) return null;
    var t = (c - p[k]) / d, o = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    return t >= 0 && t <= 1 && o[1 - k] > 2 && o[1 - k] < (k ? W : H) - 2 ? o : null;
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
  function measureAll() {
    labels.concat([call], PKS ? PKS.map(function (p) { return p.chip; }) : []).forEach(function (e) { e.w = 0; size(e); });
  }
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
      var d = (7 * (1 - t) - 12 * s * t) / s;   // just on the land when far, on the beach (12 m below the high-water line) up close
      var o = w2s(b.x + b.ux * d, b.y + b.uy * d);
      b.sx = o[0];
      b.sy = o[1];
      b.on = !(b.sx < -20 || b.sx > W + 20 || b.sy < -20 || b.sy > H + 20 || hit([b.sx - 4, b.sy - 4, b.sx + 4, b.sy + 4], furn));
      if (!b.on) { hide(b.dot); return; }
      put(b.dot, b.sx, b.sy);
      boxes.push([b.sx - 6, b.sy - 6, b.sx + 6, b.sy + 6]);
    });
    var ang = B.filter(function (b) { return b.anglet; });
    // Anglet: a bracket when far, then one name for the seven, then each beach
    var ys = ang.map(function (b) { return b.sy; }), xs = ang.map(function (b) { return b.sx; });
    var y1 = Math.min.apply(null, ys), y2 = Math.max.apply(null, ys), bx0 = Math.min.apply(null, xs) - 16;
    if (s < 0.03 && !SP) {
      brLine.style.height = Math.round(y2 - y1) + "px";
      put(brLine, bx0, y1);
      size(brText);
      tryLabel(brText, bx0 - 8 - brText.w, (y1 + y2) / 2 - brText.h / 2 + 0.5, true);
      boxes.push([bx0 - 1, y1, bx0 + 7, y2]);
    } else { hide(brLine); hide(brText); }
    var mid = ang[Math.floor(ang.length / 2)];
    tryLabel(cluster, mid.sx + 12, mid.sy - size(cluster).h / 2, !SP && s >= 0.03 && s < 0.1);
    if (demo && callB && s < 0.03 && W > 640 && !SP) {
      size(call);
      var cx = callB.sx - 18 - call.w, cy = callB.sy - call.h + 12;   // its pointer near the foot, clear of the next dot south
      put(call, cx, cy);
      boxes.push([cx, cy, cx + call.w + 18, cy + call.h]);
    } else hide(call);
    chips(demo);
    B.forEach(function (b) {               // right of the dot, else left of it
      var show = b.on && (b.anglet ? s >= 0.1 : s >= 0.035), g = nr ? 10 : 9, y = b.sy - size(b.lab).h / 2;
      if (!tryLabel(b.lab, b.sx + g, y, show) && show) tryLabel(b.lab, b.sx - g - b.lab.w, y, true);
    });
    T.forEach(function (o) {
      var p = w2s(o.x, o.y);
      size(o.lab);
      tryLabel(o.lab, p[0], p[1] - o.lab.h * 0.8, s < 0.3);
    });
    PL.forEach(function (o) {
      var p = w2s(o.x, o.y);
      size(o.lab);
      tryLabel(o.lab, p[0] - o.lab.w / 2, p[1] - o.lab.h / 2, s >= 0.25);
    });
  }
  function chips(demo) {                   // each peak's name, range and face on a thin leader above it, else lifted, else none
    if (!PKS) return;
    var a = ramp(cam.s, 0.45, 0.6);
    PKS.forEach(function (p) {
      var o = w2s(p.x, p.y), e = size(p.chip), ok = false;
      if (!demo || a <= 0 || o[0] < -80 || o[0] > W + 80 || o[1] < -20 || o[1] > H + 100) { hide(p.el); return; }
      for (var i = 0; i < 2 && !ok; i++) {
        var ld = i ? 50 : 24, bx = [o[0] - e.w / 2 - 2, o[1] - ld - e.h - 2, o[0] + e.w / 2 + 2, o[1] - 3];
        if (bx[0] < 0 || bx[2] > W || bx[1] < 0 || hit(bx, boxes) || hit(bx, furn)) continue;
        boxes.push(bx);
        p.el.style.setProperty("--ld", ld + "px");
        p.el.style.opacity = a;
        put(p.el, o[0], o[1]);
        ok = true;
      }
      if (!ok) hide(p.el);
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
  var SKIP = ".imctl,.lgm,.mfoot,.mcred,.mcap,.imcall,.imsatcard,.imsat,.fc";   // .imsat: Apple's logo and Legal link
  host.addEventListener("wheel", function (e) {
    if (!ready || e.target.closest(".imsatcard")) return;
    if (!e.ctrlKey && !e.metaKey) {
      if (SP && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {   // the beach page: a sideways swipe walks the shore
        e.preventDefault();
        stop();
        interacted();
        panBy(-(e.deltaMode === 1 ? e.deltaX * 33 : e.deltaMode ? e.deltaX * 600 : e.deltaX), 0);
        return;
      }
      showHint(MAC ? D.hints[0] : D.hints[1]);
      return;
    }
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
    if (!ready || (e.pointerType === "touch" && !SP) || e.button !== 0 || e.target.closest(SKIP)) return;   // the beach page takes a finger sideways
    drag = {id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, v: []};
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (touchOn) { drag = null; host.classList.remove("drag"); return; }   // two fingers: the pinch has it
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
      var mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top, w = s2w(mx, my);
      tp = {d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s: cam.s, r: r, wx: w[0], wy: w[1]};
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
      var s = clamp(tp.s * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1) / tp.d, zmin, SMAX);
      if (!SP && s > SREG && tp.s <= SREG + 1e-9 && !sat.on && !inFrame(tp.wx, tp.wy)) s = SREG;
      set(at(tp.wx, tp.wy, mx, my, s));
    } else if (tap && e.touches.length === 1 && !tap.moved) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - tap.x) + Math.abs(t.clientY - tap.y) > 10) {
        tap.moved = true;
        if (!SP) showHint(D.hints[2]);
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
      if (sat.on) satOff(); else if (satChoice() === "yes") satOn(); else satAsk();
      return;
    }
    if (b === satOnly) {                    // consent withdrawn: kept as a "no", and MapKit's map goes at once
      satKeep("no");
      satDrop();
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
    if (SP) {                              // the beach page: along the shore to that beach, or its waitlist
      if (SP.m[b.slug]) goBeach(b.slug); else if (b.href) window.location.href = b.href;
      return;
    }
    // fly to the beach (close enough for its peaks in Demo), or open its page once there
    var close = !inFrame(b.x, b.y) ? (sat.on ? 0.45 : 0.12) : root.hasAttribute("data-demo") && b.anglet ? 0.9 : 0.45;
    var cx = b.x - b.ux * 40, cy = b.y - b.uy * 40;
    if (cam.s < close * 0.7 || Math.hypot(cx - cam.x, cy - cam.y) * cam.s > Math.min(W, H) / 3) fly({x: cx, y: cy, s: Math.max(close, cam.s)});
    else if (b.href) window.location.href = b.href;
  });

  host.addEventListener("imap:goto", function (e) {   // the beach page's "Also good now"
    var k = e.detail && e.detail.slug;
    if (!SP || !SP.m[k]) return;
    if (!ready) { setBeach(k); cam = {x: home.x, y: home.y, s: home.s}; req(); return; }
    interacted();
    goBeach(k);
  });

  // ---------------------------------------------------------------- Apple's satellite view, loaded only when asked for
  // Nothing goes to Apple until someone picks it on the card; the pick stays in this browser. Our map fades out over
  // Apple's, which follows our camera; the dots, names, peaks and grid stay ours. Both answers are kept 6 months, as
  // "yes" or "no" and the day, then the card asks again (legal, 30 Oct 2026); Privacy's switch writes the same key.
  var SAT_KEY = "obsurf.satellite", SAT_DAYS = 183;
  function satChoice() {
    try {
      var m = /^(yes|no) (\d{4}-\d\d-\d\d)$/.exec(localStorage.getItem(SAT_KEY) || "");
      if (m && (Date.now() - Date.parse(m[2])) / 864e5 < SAT_DAYS) return m[1];
      if (localStorage.getItem(SAT_KEY) !== null) localStorage.removeItem(SAT_KEY);   // too old, or a yes from before
    } catch (e) { /* nothing stored */ }
    return "";
  }
  function satKeep(v) { try { localStorage.setItem(SAT_KEY, v + " " + new Date().toISOString().slice(0, 10)); } catch (e) { /* asked again next time */ } }
  window.addEventListener("storage", function (e) {    // switched off on Privacy, in another tab
    if ((e.key === SAT_KEY || e.key === null) && sat.st && satChoice() !== "yes") satDrop();
  });
  function satAsk() {
    if (!satCard) {
      satCard = document.createElement("div");
      satCard.className = "imsatcard";
      satCard.tabIndex = -1;
      satCard.setAttribute("role", "dialog");
      satCard.setAttribute("aria-labelledby", "imsat-t");
      satCard.setAttribute("aria-describedby", "imsat-d imsat-k");
      satCard.innerHTML = '<b id="imsat-t"></b><p id="imsat-d"></p><p><small id="imsat-k"></small></p>' +
        '<div class="row"><button type="button" data-s="ok"></button><button type="button" data-s="no"></button></div>' +
        '<p class="aft"><small></small> <a></a></p>';
      satCard.querySelector("b").textContent = SAT.title;
      satCard.querySelector("#imsat-d").textContent = SAT.card;
      satCard.querySelector("#imsat-k").textContent = SAT.small;
      satCard.querySelector(".aft small").textContent = SAT.after;
      satCard.querySelector(".aft a").textContent = SAT.link;
      satCard.querySelector(".aft a").href = SAT.href;
      satCard.querySelector("[data-s=ok]").textContent = SAT.ok;
      satCard.querySelector("[data-s=no]").textContent = SAT.no;
      satCard.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        satClose();
        var yes = b.getAttribute("data-s") === "ok";
        satKeep(yes ? "yes" : "no");
        if (yes) satOn();
      });
      satCard.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); satClose(); } });
      host.appendChild(satCard);
    }
    satCard.hidden = false;
    satCard.focus({preventScroll: true});   // the card, not a button: neither answer is picked for you
    req();                                  // the info card steps aside while this one asks
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
    box.classList.add("sat");
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
    if (SP) {
      var d0 = sat.map.cameraDistance;
      sat.k = d0 > 0 ? d0 * cam.s / H : 0;
      if (!sat.k) { satFail(); return; }
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
  function satDrop() {                    // withdrawn: Apple's map is destroyed at once, so MapKit has nothing left to ask for
    if (sat.on) satOff();
    clearTimeout(sat.timer);
    if (sat.map) { try { sat.map.destroy(); } catch (e) { /* already gone */ } }
    if (sat.el) sat.el.remove();
    sat.el = sat.map = null;
    sat.st = 0;
    sat.f = 0;
    satBtn.classList.remove("busy");
    req();
  }
  function satOff() {
    sat.on = false;
    satBtn.setAttribute("aria-pressed", "false");
    satOnly.hidden = true;
    host.classList.remove("sat");
    box.classList.remove("sat");
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
    if (SP) {
      var M = window.mapkit, c = toLL(cam.x, cam.y);
      sat.map.rotation = SAT_TURN;
      sat.map.center = new M.Coordinate(c[0], c[1]);
      sat.map.cameraDistance = sat.k * H / cam.s;
    } else sat.map.setRegionAnimated(satRegion(), false);
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
  if (SP) setBeach(cur);
  colours();
  states();
  furniture();
  measureAll();
  frame(performance.now());
  load();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
  window.addEventListener("resize", resize);
  new MutationObserver(states).observe(root, {attributes: true, attributeFilter: ["data-demo"]});
  var recolour = function () { colours(); req(); };
  if (dark.addEventListener) dark.addEventListener("change", recolour); else if (dark.addListener) dark.addListener(recolour);
})();
