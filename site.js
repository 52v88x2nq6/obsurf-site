(function () {
  "use strict";
  var KEY = "obsurf-demo", root = document.documentElement, saved = new Map();

  function stored() {
    try {
      var q = new URLSearchParams(location.search).get("demo");
      if (q === "1" || q === "on") return true;
      if (q === "0" || q === "off") return false;
      return window.localStorage.getItem(KEY) === "1";
    } catch (e) { return false; }
  }
  function store(on) { try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {} }

  function apply(on) {
    if (on) root.setAttribute("data-demo", ""); else root.removeAttribute("data-demo");
    document.querySelectorAll("[data-swap]").forEach(function (el) {
      var tpl = document.querySelector('template[data-demo="' + el.getAttribute("data-swap") + '"]');
      if (!tpl) return;
      if (on) {
        if (!saved.has(el)) saved.set(el, el.innerHTML);
        el.innerHTML = "";
        el.appendChild(tpl.content.cloneNode(true));
      } else if (saved.has(el)) {
        el.innerHTML = saved.get(el);
      }
    });
    document.querySelectorAll(".demo-switch").forEach(function (b) { b.setAttribute("aria-checked", on ? "true" : "false"); });
    document.querySelectorAll("fieldset.lockable").forEach(function (f) { f.disabled = !on; });
    document.querySelectorAll("[data-honest]").forEach(function (el) { el.hidden = on; });
    filterBeaches();
  }
  function setDemo(on) {
    var previous = document.activeElement;
    store(on);
    apply(on);
    if (previous && (!previous.isConnected || !previous.getClientRects().length || previous.matches(":disabled"))) {
      var control = document.querySelector(".demo-switch");
      if (control) control.focus();
    }
    var status = document.getElementById("demo-status");
    if (status) status.textContent = on ? "Demo on. Figures are illustrations, not data. Forms send nothing." : "Demo off. Example figures are hidden.";
  }

  var toastTimer;
  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  // beach search and "near me" (spots page)
  var origin = null;
  function km(a, b, c, d) {
    var r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function filterBeaches() {
    var list = document.querySelector(".blist"), input = document.getElementById("bq");
    if (!list || !input) return;
    var q = norm(input.value), shown = 0, items = Array.prototype.slice.call(list.children);
    items.forEach(function (li) {
      var hay = norm([li.dataset.name, li.dataset.town, li.dataset.pc].join(" "));
      var ok = !q || hay.indexOf(q) !== -1;
      li.hidden = !ok;
      if (ok) shown++;
      var k = li.querySelector("[data-km]");
      if (k) k.textContent = origin ? "· " + Math.round(km(origin[0], origin[1], +li.dataset.lat, +li.dataset.lon)) + " km" : "";
    });
    if (origin) {
      items.sort(function (a, b) {
        return km(origin[0], origin[1], +a.dataset.lat, +a.dataset.lon) - km(origin[0], origin[1], +b.dataset.lat, +b.dataset.lon);
      }).forEach(function (li) { list.appendChild(li); });
    }
    var none = document.getElementById("noresult");
    if (none) none.hidden = shown > 0;
  }
  function near() {
    var note = document.getElementById("nearnote");
    if (!navigator.geolocation) { if (note) note.textContent = "Your browser can't share a location."; return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      origin = [p.coords.latitude, p.coords.longitude];
      if (note) note.textContent = "Sorted by distance from you. Your location wasn't sent or stored.";
      filterBeaches();
    }, function () {
      if (note) note.textContent = "No location shared, so the list keeps its order.";
    }, { maximumAge: 600000, timeout: 10000 });
  }

  // spot page: the drawn plan or the aerial photo (its image loads the first time it's picked)
  function layer(k) {
    var stage = document.querySelector(".stage");
    if (!stage) return;
    stage.setAttribute("data-layer", k);
    stage.querySelectorAll("button[data-layer]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-layer") === k ? "true" : "false"); });
    var img = stage.querySelector("image[data-href]");
    if (k === "sat" && img && !img.getAttribute("href")) img.setAttribute("href", img.getAttribute("data-href"));
  }

  // "Already asked?" on the request page
  function asked() {
    var input = document.getElementById("rq-t"), box = document.getElementById("asked"), out = document.getElementById("asked-list"), data = document.getElementById("roadmap-items");
    if (!input || !box || !data) return;
    var items = JSON.parse(data.textContent), words = norm(input.value).split(" ").filter(function (w) { return w.length > 3; });
    var hits = words.length ? items.filter(function (it) { var t = norm(it.t); return words.some(function (w) { return t.indexOf(w) !== -1; }); }).slice(0, 3) : [];
    out.innerHTML = "";
    hits.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "cell";
      row.innerHTML = "<span><b></b><small></small></span>";
      row.querySelector("b").textContent = it.t;
      row.querySelector("small").textContent = it.s;
      out.appendChild(row);
    });
    box.hidden = hits.length === 0;
  }

  // contact: show only what the topic needs
  function topic() {
    var r = document.querySelector('.topics input:checked');
    if (!r) return;
    var k = r.value, name = document.getElementById("topic-name");
    if (name) name.textContent = r.parentNode.textContent.trim();
    document.querySelectorAll("[data-for]").forEach(function (el) {
      el.hidden = el.getAttribute("data-for").split(" ").indexOf(k) === -1;
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a");
    if (!t) return;
    if (t.classList.contains("demo-switch")) { setDemo(t.getAttribute("aria-checked") !== "true"); return; }
    if (t.classList.contains("demo-off")) { setDemo(false); return; }
    if (t.classList.contains("demo-on")) { setDemo(true); window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
    if (t.classList.contains("menu")) {
      var nav = document.getElementById("mainnav"), open = t.getAttribute("aria-expanded") !== "true";
      t.setAttribute("aria-expanded", open ? "true" : "false");
      if (nav) {
        nav.classList.toggle("open", open);
        if (open && nav.querySelector("a")) nav.querySelector("a").focus();
      }
      return;
    }
    if (t.id === "near") { near(); return; }
    if (t.hasAttribute("data-layer")) { layer(t.getAttribute("data-layer")); return; }
    if (t.hasAttribute("data-copy")) {
      var url = t.getAttribute("data-copy");
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied: " + url); }, function () { toast(url); });
      else toast(url);
      return;
    }
    if (t.hasAttribute("data-send")) { toast("Demo: nothing was sent."); return; }
    if (t.classList.contains("metoo")) {
      var on = t.getAttribute("aria-pressed") !== "true", c = t.querySelector(".c"), n = t.getAttribute("data-count");
      t.setAttribute("aria-pressed", on ? "true" : "false");
      if (c && /^\d+$/.test(n)) c.textContent = String(+n + (on ? 1 : 0) - (t.dataset.base === "1" ? 1 : 0));
      toast(on ? "Demo: Me too counted on this page only." : "Demo: vote taken back.");
      return;
    }
    if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains("chips")) {
      var group = t.parentNode, multi = group.getAttribute("aria-label") === "Beaches";
      if (!multi) group.querySelectorAll("button").forEach(function (b) { if (b !== t) b.setAttribute("aria-pressed", "false"); });
      t.setAttribute("aria-pressed", t.getAttribute("aria-pressed") === "true" ? "false" : "true");
      return;
    }
    if (t.getAttribute("role") === "tab") {
      selectTab(t);
      return;
    }
  });
  function selectTab(tab) {
    tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]').forEach(function (b) {
      var selected = b === tab;
      b.setAttribute("aria-selected", selected ? "true" : "false");
      b.tabIndex = selected ? 0 : -1;
      var panel = document.getElementById(b.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
  }
  document.addEventListener("keydown", function (e) {
    var tab = e.target.closest('[role="tab"]');
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) !== -1) {
      var tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
      var i = tabs.indexOf(tab);
      i = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      selectTab(tabs[i]);
      tabs[i].focus();
    }
    if (e.key === "Escape") {
      var menu = document.querySelector('.menu[aria-expanded="true"]');
      if (menu && (e.target === menu || e.target.closest("#mainnav"))) {
        menu.setAttribute("aria-expanded", "false");
        document.getElementById("mainnav").classList.remove("open");
        menu.focus();
      }
    }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "bq") filterBeaches();
    if (e.target.id === "rq-t") asked();
  });
  document.addEventListener("change", function (e) { if (e.target.name === "topic") topic(); });
  document.addEventListener("submit", function (e) { if (e.target.hasAttribute("data-nosend")) e.preventDefault(); });

  document.addEventListener("DOMContentLoaded", function () {
    var p = new URLSearchParams(location.search);
    var bq = document.getElementById("bq");
    if (bq && p.get("q")) bq.value = p.get("q");
    var tp = p.get("topic");
    if (tp) { var r = document.querySelector('.topics input[value="' + tp.replace(/[^a-z]/g, "") + '"]'); if (r) r.checked = true; }
    apply(stored());
    topic();
    if (p.get("near") === "1" && document.getElementById("near")) near();
  });
})();
