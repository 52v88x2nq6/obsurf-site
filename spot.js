(function () {
  "use strict";
  // The beach page: its title and figures follow the beach in view on the map (map.js says which, as imap:beach) and
  // switch with Demo. Each beach's parts wait in templates: data-sp="<beach>:h" without Demo, "<beach>:d" with it.
  var root = document.documentElement, host = document.querySelector("[data-spot]");
  var ttl = document.querySelector('[data-part="ttl"]'), main = document.querySelector('[data-part="main"]');
  var live = document.getElementById("sv-status"), motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!host || !ttl || !main || !("content" in document.createElement("template"))) return;
  var own = host.getAttribute("data-spot"), cur = "", mode = "", timer = 0, started = false, toTitle = false;
  function tpl(slug, k) { return document.querySelector('template[data-sp="' + slug + ":" + k + '"]'); }
  function render(slug, say) {
    var k = root.hasAttribute("data-demo") ? "d" : "h", t = tpl(slug, k);
    if (!t || (slug === cur && k === mode)) return;
    if (cur && slug !== cur && history.replaceState) {
      history.replaceState(null, "", slug === own ? location.pathname + location.search : "#" + slug);
    }
    cur = slug;
    mode = k;
    function fill() {
      var had = document.activeElement;               // "Show an example" goes with the parts it sits in
      ttl.innerHTML = t.content.querySelector('[data-p="ttl"]').innerHTML;
      main.innerHTML = t.content.querySelector('[data-p="main"]').innerHTML;
      document.title = t.getAttribute("data-title");
      if (say && live) live.textContent = t.getAttribute("data-name");
      if (toTitle || (had && !had.isConnected)) { toTitle = false; ttl.focus({preventScroll: true}); }
      document.dispatchEvent(new CustomEvent("ob:parts"));
    }
    clearTimeout(timer);
    if (!started || motion.matches) { fill(); return; }
    ttl.classList.add("fade");
    main.classList.add("fade");
    timer = setTimeout(function () { fill(); ttl.classList.remove("fade"); main.classList.remove("fade"); }, 140);
  }
  host.addEventListener("imap:beach", function (e) { render(e.detail.slug, true); });
  new MutationObserver(function () { if (cur) render(cur, false); }).observe(root, {attributes: true, attributeFilter: ["data-demo"]});
  document.addEventListener("click", function (e) {      // "Also good now": the figures switch and the map goes there
    var b = e.target.closest("[data-goto]");
    if (!b) return;
    var slug = b.getAttribute("data-goto"), top = document.querySelector(".sv");
    toTitle = true;
    render(slug, true);
    host.dispatchEvent(new CustomEvent("imap:goto", {detail: {slug: slug}}));
    if (top) top.scrollIntoView({behavior: motion.matches ? "auto" : "smooth", block: "start"});
  });
  // Sunrise and sunset under the tide: today at the beach in view, in the beach's own time, from its latitude and
  // longitude by NOAA's solar calculator (the sun's centre 0.833° below the horizon), each worked out twice, the second
  // time with the sun as it is at that moment, so the minute is right.
  var TZ = "Europe/Paris", sunFmt = null, dayFmt = null;
  try {
    sunFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, hour: "2-digit", minute: "2-digit"});
    dayFmt = new Intl.DateTimeFormat("en-GB", {timeZone: TZ, year: "numeric", month: "numeric", day: "numeric"});
  } catch (e) { /* no times */ }
  function sunTimes(lat, lon, now) {
    var p = {}, rad = Math.PI / 180;
    dayFmt.formatToParts(now).forEach(function (x) { p[x.type] = +x.value; });
    var day = Date.UTC(p.year, p.month - 1, p.day);            // midnight UTC on the beach's date
    function sun(min) {                     // the sun's noon and half its day, in minutes from that midnight, near `min`
      var t = ((day + min * 6e4) / 864e5 + 2440587.5 - 2451545) / 36525;
      var l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360, m = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * rad;
      var e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t), om = (125.04 - 1934.136 * t) * rad;
      var c = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289;
      var lam = (l0 + c - 0.00569 - 0.00478 * Math.sin(om)) * rad;
      var eps = (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om)) * rad;
      var dec = Math.asin(Math.sin(eps) * Math.sin(lam)), y = Math.pow(Math.tan(eps / 2), 2), l = l0 * rad;
      var eot = 4 / rad * (y * Math.sin(2 * l) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l)
                           - 0.5 * y * y * Math.sin(4 * l) - 1.25 * e * e * Math.sin(2 * m));
      var ch = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
      return [720 - 4 * lon - eot, ch > -1 && ch < 1 ? 4 * Math.acos(ch) / rad : NaN];
    }
    var s = sun(720), rise = sun(s[0] - s[1]), set = sun(s[0] + s[1]);
    if (isNaN(rise[1]) || isNaN(set[1])) return null;
    return [rise[0] - rise[1], set[0] + set[1]].map(function (min) { return new Date(day + min * 6e4); });
  }
  document.addEventListener("ob:parts", function () {
    if (!sunFmt) return;
    main.querySelectorAll("[data-sun]").forEach(function (el) {
      var ll = el.getAttribute("data-sun").split(","), t = sunTimes(+ll[0], +ll[1], new Date()), b = el.querySelectorAll("b");
      if (!t || b.length < 2) return;
      b[0].textContent = sunFmt.format(t[0]);
      b[1].textContent = sunFmt.format(t[1]);
      el.hidden = false;
    });
  });
  var hash = (location.hash || "").slice(1);
  render(host.getAttribute("data-beach") || (tpl(hash, "h") ? hash : own), false);
  document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { started = true; }, 0); });
})();
