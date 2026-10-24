/*
 * 広告の読み込み（Googleスプレッドシート → 広告枠）
 * ------------------------------------------------------------
 * ・スプレッドシートは「1行＝サイト上の広告枠1か所」です。
 *   列：A 枠番号 / B 掲載ページ / C 掲載位置 / D 広告コード
 *   （B・C列は説明用です。読み込むのは A 枠番号 と D 広告コード だけです）
 * ・ページ内の広告枠（data-ad-slot="番号"）に、同じ枠番号の行の広告コードを表示します。
 * ・広告コードは書き換えずにそのまま表示します。
 *   <script> を含むコード（楽天モーションウィジェットなど）は、枠の中の小さなページ（iframe）でそのまま動かします。
 * ・広告コードが空欄の枠は表示しません。
 */
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var url = (cfg.adSheetCsvUrl || "").trim();
  var frames = Array.prototype.slice.call(document.querySelectorAll(".ad-frame"));
  if (!frames.length || !url) return; // 未設定のあいだは「広告枠 番号」の表示のまま

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

  function toNumber(s) {
    s = (s || "").replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); });
    var m = s.match(/\d+/);
    return m ? m[0] : "";
  }

  // 枠番号 → 広告コード
  function toSlots(rows) {
    var col = { slot: 0, code: 3 };
    if (rows.length) {
      var head = rows[0].map(function (h) { return (h || "").trim(); });
      var hasHeader = head.some(function (h) { return /枠番号|広告コード/.test(h); });
      if (hasHeader) {
        head.forEach(function (h, i) {
          if (/枠番号|番号/.test(h)) col.slot = i;
          else if (/広告コード|コード/.test(h)) col.code = i;
        });
        rows = rows.slice(1);
      }
    }
    var map = {};
    rows.forEach(function (r) {
      var n = toNumber(r[col.slot]);
      var code = (r[col.code] || "").trim();
      if (n && code) map[n] = code;
    });
    return map;
  }

  // ---- 表示
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

  function render(frame, code) {
    var body = frame.querySelector(".ad-body");
    if (!body) return;
    if (/<script/i.test(code)) renderInFrame(body, code);
    else body.innerHTML = code;
  }

  function hideAll() {
    frames.forEach(function (fr) { fr.classList.add("is-empty"); });
  }

  fetch(url, { cache: "no-cache" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.text(); })
    .then(function (text) {
      var map = toSlots(parseCSV(text));
      frames.forEach(function (fr) {
        var code = map[fr.getAttribute("data-ad-slot")];
        if (code) render(fr, code);
        else fr.classList.add("is-empty");
      });
    })
    .catch(function () { hideAll(); });
})();
