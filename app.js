/* Vegas 2026 — renders the itinerary from data.json.
   Pure builder (buildHTML) is unit-testable in Node; browser bootstrap fetches + injects. */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function firstToken(s) { return String(s || "").trim().split(/\s+/)[0] || ""; }
  // Safety net for a DATE cell exported as a raw JS Date object ("Thu Jul 18 2026 ..." -> "Jul 18").
  // Dates only: a date's day-of-month survives the export intact. TIMES are NOT healed here —
  // Sheets shifts time-only values by ~1h on export, so a healed time would be wrong; times must
  // come from the sheet via getDisplayValues(). A mangled time therefore shows loudly (not subtly).
  function cleanDateish(s) {
    var m = String(s == null ? "" : s).match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{2}) (\d{4}) \d{2}:\d{2}:/);
    if (!m || parseInt(m[3], 10) < 2000) return s; // year<2000 => a time-only export, leave it loud
    return m[1] + " " + String(parseInt(m[2], 10));
  }
  function normalizeDates_(data) {
    (data.plan || []).forEach(function (p) { p.date = cleanDateish(p.date); });
    return data;
  }
  // Chronological sort keys. Events keep their vote-options attached (they're sorted as a unit).
  var MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  function dateKey_(d) {
    var m = String(d || "").match(/([A-Za-z]{3})\s+(\d{1,2})/);
    return m && MONTHS[m[1]] ? MONTHS[m[1]] * 100 + parseInt(m[2], 10) : 99999; // no/unknown date -> last
  }
  function timeKey_(t) {
    var m = String(t || "").match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    if (!m) return 99999; // no start time -> end of its day
    var h = parseInt(m[1], 10), mm = parseInt(m[2], 10), ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + mm;
  }
  function sortEvents_(events) {
    events.forEach(function (ev, i) { ev._i = i; });
    return events.slice().sort(function (a, b) {
      var da = dateKey_(a.row.date), db = dateKey_(b.row.date);
      if (da !== db) return da - db;
      var ta = timeKey_(a.row.start || a.row.stop), tb = timeKey_(b.row.start || b.row.stop);
      if (ta !== tb) return ta - tb;
      return a._i - b._i; // stable: keep authored order on ties
    });
  }
  function hasEmoji(s) {
    try { return /\p{Extended_Pictographic}/u.test(s); }
    catch (e) { return /[☀-➿✈\uD83C-\uDBFF]/.test(s); }
  }
  function iconFor(s) {
    var map = [
      [/pool|beach|cabana|swim/i, "🏊"],
      [/cream|dessert|ice.?cream|gelato/i, "🍦"],
      [/drink|cocktail|speakeasy|\bbar\b/i, "🍸"],
      [/land|fly|flight|airport|arrive|depart/i, "✈"],
      [/world cup|soccer|match|\bgame\b/i, "⚽"],
      [/backstreet|sphere|show|concert|residency/i, "🎤"],
      [/dinner|steak|brunch|lunch/i, "🍽️"]
    ];
    for (var i = 0; i < map.length; i++) { if (map[i][0].test(s)) return map[i][1]; }
    return "";
  }
  function parseOption(activity) {
    var m = String(activity || "").match(/^\s*option\s*[—–-]\s*(.+)$/i);
    return m ? m[1].trim() : null;
  }
  function isFeatured(a) { return /★/.test(a) || /🎂/.test(a); }
  function isBirthday(a) { return /🎂/.test(a); }
  function cleanActivity(a) {
    return String(a || "").replace(/^[\s★]+/, "").replace(/^\s*🎂\s*/, "").trim();
  }
  function chip(url, label, cls) {
    return '<a class="chip' + (cls ? " " + cls : "") + '" href="' + esc(url) +
      '" target="_blank" rel="noopener">' + label + " ↗</a>";
  }
  function renderChips(website, menu, siteLabel) {
    if (!website && !menu) return "";
    var h = '<div class="links">';
    if (website) h += chip(website, siteLabel || "Site", "");
    if (menu) h += chip(menu, "Menu", "menu");
    return h + "</div>";
  }
  function renderOptions(options, parentRow) {
    if (!options.length) return "";
    var hasLinks = options.some(function (o) { return o.website || o.menu; });
    if (hasLinks) {
      var h = '<div class="picks">';
      options.forEach(function (o) {
        h += '<div class="pick"><span class="pname">' + esc(o.name) + "</span>" +
          (o.cuisine ? '<span class="pcuis">' + esc(o.cuisine) + "</span>" : "") +
          '<span class="spacer"></span>' +
          (o.website ? chip(o.website, "Site", "") : "") +
          (o.menu ? chip(o.menu, "Menu", "menu") : "") + "</div>";
      });
      return h + "</div>";
    }
    var pk = String(parentRow.place || "").toLowerCase().replace(/[^a-z]/g, "");
    var h2 = '<div class="opts">';
    options.forEach(function (o) {
      var on = String(o.name || "").toLowerCase().replace(/[^a-z]/g, "");
      var isLead = pk && on && (pk.indexOf(on) === 0 || on.indexOf(pk) === 0);
      h2 += '<span class="opt' + (isLead ? " lead" : "") + '">' + esc(o.name) + "</span>";
    });
    return h2 + "</div>";
  }

  function buildEvents(plan) {
    var events = [];
    (plan || []).forEach(function (row) {
      var opt = parseOption(row.activity);
      if (opt && events.length) {
        events[events.length - 1].options.push({
          name: opt, website: row.website, menu: row.menu, cuisine: row.notes, place: row.place
        });
      } else {
        events.push({ row: row, options: [] });
      }
    });
    return events;
  }

  function renderEvent(ev) {
    var r = ev.row;
    var featured = isFeatured(r.activity);
    var bday = isBirthday(r.activity);
    var hasOpts = ev.options.length > 0;

    var headText = esc(cleanActivity(r.activity)) || esc(r.place) || "TBD";
    if (!hasEmoji(headText)) {
      var ic = iconFor((r.activity || "") + " " + (r.place || ""));
      if (ic) headText += " " + ic;
    }

    var time = r.start ? (r.stop ? r.start + "–" + r.stop : r.start) : (r.stop || "");

    var parts = [];
    var headLower = headText.toLowerCase();
    var placeKey = String(r.place || "").replace(/\?$/, "").trim().toLowerCase();
    if (r.place && !hasOpts && placeKey && headLower.indexOf(placeKey) === -1) parts.push(esc(r.place));
    if (r.notes) parts.push(esc(r.notes));

    var metaInner = "";
    if (!featured && time) metaInner += "<b>" + esc(time) + "</b>" + (parts.length ? " · " : "");
    metaInner += parts.join(" · ");

    var whoTag = "";
    if (r.who && !bday) {
      var w = /group/i.test(r.who) ? "whole crew" : r.who;
      whoTag = ' <span class="who">· ' + esc(w) + "</span>";
    }

    var tagHtml = "";
    if (featured) {
      var tag = bday
        ? "🎂 Birthday · " + (hasOpts ? "cast a vote" : "undecided")
        : "★ Main Event" + (time ? " · " + esc(time) : "");
      tagHtml = '<span class="tag">' + tag + "</span>";
    }

    var siteLabel = /sphere|show|ticket|concert/i.test(r.activity || "") ? "Show page" : "Site";
    var chips = renderChips(r.website, r.menu, siteLabel);
    var optsHtml = renderOptions(ev.options, r);

    var metaBlock = (metaInner || whoTag) ? '<div class="meta">' + metaInner + whoTag + "</div>" : "";

    return '<div class="event' + (featured ? " star" : "") + '">' +
      renderWhen(r) +
      '<div class="body">' + tagHtml +
        '<div class="headline">' + headText + "</div>" +
        metaBlock + chips + optsHtml +
      "</div></div>";
  }
  function renderWhen(r) {
    return '<div class="when"><div class="dow">' + esc(r.day || "") +
      '</div><div class="date">' + esc(r.date || "") + "</div></div>";
  }

  function renderCrew(travelers) {
    var order = [], groups = {};
    (travelers || []).forEach(function (t) {
      if (!groups[t.couple]) { groups[t.couple] = []; order.push(t.couple); }
      groups[t.couple].push(t);
    });
    var h = "";
    order.forEach(function (couple) {
      h += '<p class="couple-label">◆ ' + esc(couple) + '</p><div class="crew">';
      groups[couple].forEach(function (p) {
        var inTxt = (firstToken(p.arrives) + " " + (p.arrivalTime || "")).trim();
        var outTxt = (firstToken(p.departs) + " " + (p.departureTime || "")).trim();
        if (inTxt || outTxt) {
          h += '<div class="person"><div class="nm">' + esc(p.name) + "</div>" +
            (inTxt ? '<div class="row"><span class="ic">✈</span><span class="txt">In <b>' + esc(inTxt) + "</b></span></div>" : "") +
            (outTxt ? '<div class="row out"><span class="ic">✈</span><span class="txt">Out <b>' + esc(outTxt) + "</b></span></div>" : "") +
            "</div>";
        } else {
          h += '<div class="person tbd"><div class="nm">' + esc(p.name) +
            '</div><div class="todo">Drop your flights in the sheet →</div></div>';
        }
      });
      h += "</div>";
    });
    return h;
  }

  function renderHero(hero) {
    hero = hero || {};
    return "<header>" +
      '<p class="eyebrow">' + esc(hero.eyebrow || "") + "</p>" +
      '<div class="marquee"><h1>' + esc(hero.title || "") + '<br><span class="yr">' + esc(hero.year || "") + "</span></h1></div>" +
      '<div class="bulbs"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<p class="dates">' + esc(hero.dates || "") + "</p>" +
      (hero.homeBase ? '<p class="homebase">Home base — <b>' + esc(hero.homeBase) + "</b></p>" : "") +
      (hero.occasion ? '<p class="occasion">' + esc(hero.occasion) + "</p>" : "") +
      '<div class="count"><span class="n" id="cd">—</span> <span class="lbl" id="cdl">sleeps till Vegas</span></div>' +
      '<p class="tznote">🕒 All times shown in Las Vegas time (PT)</p>' +
      "</header>";
  }

  function renderFooter(hero) {
    return '<div class="foot"><p>Different people, different reservations — dinners, clubs, cabanas.<br>' +
      "Add yours so nobody double-books the night.</p>" +
      '<a class="btn" href="' + esc((hero && hero.sheetUrl) || "#") + '" target="_blank" rel="noopener">Open the planning sheet →</a></div>' +
      '<p class="stamp">What happens in Vegas · goes in the group chat</p>';
  }

  function buildHTML(data) {
    data = normalizeDates_(data || {});
    return '<div class="wrap">' +
      renderHero(data.hero) +
      '<div class="sec-title"><h2>The Crew</h2><span class="rule"></span></div>' +
      renderCrew(data.travelers) +
      '<div class="sec-title"><h2>The Weekend</h2><span class="rule"></span></div>' +
      '<div class="day">' + sortEvents_(buildEvents(data.plan)).map(renderEvent).join("") + "</div>" +
      renderFooter(data.hero) +
      "</div>";
  }

  function startCountdown(dateStr) {
    var el = document.getElementById("cd"), lbl = document.getElementById("cdl");
    if (!el) return;
    var p = String(dateStr || "").split("-");
    var target = new Date(+p[0], (+p[1]) - 1, +p[2]);
    var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((target - t0) / 86400000);
    if (isNaN(days)) { el.textContent = "✦"; lbl.textContent = "viva las vegas"; return; }
    if (days > 1) { el.textContent = days; lbl.textContent = "sleeps till Vegas"; }
    else if (days === 1) { el.textContent = 1; lbl.textContent = "sleep till Vegas"; }
    else if (days === 0) { el.textContent = "IT'S"; lbl.textContent = "Vegas day, baby"; }
    else { el.textContent = "✦"; lbl.textContent = "viva las vegas"; }
  }

  // ---- Browser bootstrap ----
  if (typeof document !== "undefined") {
    var mount = function () {
      var app = document.getElementById("app");
      fetch("data.json?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) { app.innerHTML = buildHTML(data); startCountdown((data.hero || {}).countdownTo); })
        .catch(function (err) {
          console.error("Itinerary load failed:", err);
          app.innerHTML = '<div class="wrap"><header><div class="marquee"><h1>VEGAS<br>' +
            '<span class="yr">2026</span></h1></div><p class="dates">Jul 16 – 20, 2026</p></header>' +
            '<div class="foot"><p>Couldn’t load the latest plan just now — try refreshing.</p>' +
            '<a class="btn" href="https://docs.google.com/spreadsheets/d/1NrveHl0gwmjg1RVo31HRkXDiYMDZDYc86xbL4yWtBNM/edit">Open the planning sheet →</a></div></div>';
        });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildHTML: buildHTML, buildEvents: buildEvents, iconFor: iconFor, parseOption: parseOption, cleanDateish: cleanDateish };
  }
})(this);
