/*
 * 広告の読み込み（Googleスプレッドシート → 広告枠）
 * ------------------------------------------------------------
 * ・スプレッドシートの「広告コード」の列に貼り付けたコードを、書き換えずにそのまま表示します。
 * ・<script> を含むコード（楽天モーションウィジェットなど）は、ページ内の小さな枠（iframe）の中で
 *   そのまま動かします。クリックや表示の計測は広告提供元の仕組みのまま働きます。
 * ・シートの列：A 番号 / B 表示ページ（空欄＝全ページ）/ C 広告コード
 *   （以前の「種類」の列が残っていても、見出しで判別するのでそのまま使えます）
 */
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var url = (cfg.adSheetCsvUrl || "").trim();
  var frames = Array.prototype.slice.call(document.querySelectorAll(".ad-frame"));
  if (!frames.length || !url) return; // 未設定のあいだは「広告枠」の表示のまま

  var pageKey = document.body.getAttribute("data-page") || "";

  // ---- CSV（改行や " を含むセルにも対応）
  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false, i, c;
    text = text.replace(/^﻿/, "");
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; }
        } else { cell += c; }
      } else if (c === '"') { q = true; }
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* 無視 */ }
      else { cell += c; }
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function hash(s) {
    var h = 0, i;
    for (i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function pageMatch(spec) {
    spec = (spec || "").trim();
    if (!spec || spec === "全ページ" || spec === "全部" || spec === "all") return true;
    var tokens = spec.split(/[,、，\s]+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].trim().replace(/^\/+/, "").replace(/\.html$/, "");
      if (!t) continue;
      if (t === "トップ" || t === "index") t = "index";
      if (t === pageKey) return true;
      if (t.slice(-1) === "/" && pageKey.indexOf(t) === 0) return true; // 例： kanko/ で観光地ページすべて
    }
    return false;
  }

  function toAds(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return (h || "").trim(); });
    var col = { no: 0, page: 1, code: 2 };
    var hasHeader = head.some(function (h) { return /広告コード|表示ページ|番号/.test(h); });
    if (hasHeader) {
      head.forEach(function (h, i) {
        if (/番号/.test(h)) col.no = i;
        else if (/表示ページ|ページ/.test(h)) col.page = i;
        else if (/広告コード|コード/.test(h)) col.code = i;
      });
      rows = rows.slice(1);
    }
    var ads = [];
    rows.forEach(function (r, i) {
      var code = (r[col.code] || "").trim();
      if (!code) return;
      if (!pageMatch(r[col.page])) return;
      ads.push({ id: (r[col.no] || String(i + 1)).trim(), code: code });
    });
    return ads;
  }

  // ---- 表示
  function renderPlain(body, code) {
    body.innerHTML = code;
  }

  function renderInFrame(body, code) {
    var f = document.createElement("iframe");
    f.setAttribute("title", "広告");
    f.setAttribute("scrolling", "no");
    f.style.width = "300px";
    f.style.height = "300px";
    f.style.border = "0";
    f.style.overflow = "hidden";
    body.innerHTML = "";
    body.appendChild(f);
    var doc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<base target="_top">' +
      "<style>html,body{margin:0;padding:0;background:transparent}body{display:flex;justify-content:center}</style>" +
      "</head><body>" + code + "</body></html>";
    var fit = function () {
      try {
        var d = f.contentDocument;
        if (!d || !d.body) return;
        var h = d.body.scrollHeight, w = 0;
        Array.prototype.forEach.call(d.body.children, function (c) {
          var rc = c.getBoundingClientRect();
          if (rc.width > w) w = rc.width;
          if (rc.bottom > h) h = rc.bottom;
        });
        var maxW = body.clientWidth || 300;
        if (h > 0) f.style.height = h + "px";
        if (w > 0) f.style.width = Math.min(Math.max(w, 300), maxW) + "px";
      } catch (e) { /* 何もしない */ }
    };
    f.addEventListener("load", function () {
      fit();
      var n = 0, t = setInterval(function () { fit(); if (++n > 20) clearInterval(t); }, 500);
    });
    if ("srcdoc" in f) {
      f.srcdoc = doc;
    } else {
      var d = f.contentWindow.document; d.open(); d.write(doc); d.close();
    }
  }

  function render(frame, ad) {
    var body = frame.querySelector(".ad-body");
    if (!body) return;
    if (/<script/i.test(ad.code)) renderInFrame(body, ad.code);
    else renderPlain(body, ad.code);
    frame.setAttribute("data-ad-no", ad.id);
  }

  function hideAll() {
    frames.forEach(function (fr) { fr.classList.add("is-empty"); });
  }

  fetch(url, { cache: "no-cache" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.text(); })
    .then(function (text) {
      var ads = toAds(parseCSV(text));
      if (!ads.length) { hideAll(); return; }
      var used = {};
      var seed = hash(pageKey);
      frames.forEach(function (fr, idx) {
        var pool = ads.filter(function (a) { return !used[a.id]; });
        if (!pool.length) { fr.classList.add("is-empty"); return; }
        var ad = pool[(seed + idx * 7) % pool.length];
        used[ad.id] = true;
        render(fr, ad);
      });
    })
    .catch(function () { hideAll(); });
})();
