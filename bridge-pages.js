/* Split-brain bridge shim — GITHUB PAGES EDITION.
 * Loaded in <head> of every hosted surface page (fallback hosting).
 * There is no serverless function on Pages, so the data path is:
 *   GET  -> encrypted snapshot files on the repo's `data` branch, read via
 *           raw.githubusercontent.com and decrypted in-page (WebCrypto)
 *           with keys derived from the access key Trishul enters once.
 *   POST -> an encrypted action envelope; the page opens a prefilled
 *           GitHub issue (his own signed-in tap is the write channel),
 *           the VM bridge drains issues, executes against the real
 *           localhost surface, and commits the encrypted result to the
 *           data branch, which this shim polls.
 * Binary library assets (MediaPipe .wasm/.data/.binarypb) are stored as
 * .b64 text (the GitHub push path is UTF-8 only) and decoded in-page.
 * Dashboard audio (his own recordings) is stored AES-encrypted (.enc)
 * and decrypted in-page; it never sits on public hosting in plaintext.
 * Crypto mirrors sb_crypto.py exactly: PBKDF2-HMAC-SHA256 (100k, salt
 * "vinayaki-split-brain-v1") -> AES-256-CBC + HMAC-SHA256 (EtM).
 * EventSource is stubbed to fail fast so Buddhi Live uses its built-in
 * polling fallback, which this bridge serves from snapshots.
 * REALTIME HONESTY (Pages edition): there is no serverless function
 * and no socket on a static host; snapshot reads ride
 * raw.githubusercontent.com, whose CDN caching makes end-to-end
 * freshness ~1-5 minutes no matter how fast this shim polls. That
 * bound is stated, not hidden — the provenance chip shows each
 * snapshot's own fetched_at so staleness is always visible.
 * TantricSync: snapshot envelopes carry a provenance type assigned
 * by the VM bridge (never by the producer); the shim renders it as a
 * small provenance chip (bottom-left) — the light must not lie. A
 * sentinel badge (top-right) shows Peak Sentinel countdowns from the
 * bridge's encrypted /api/sentinel snapshot. */
(function () {
  "use strict";
  var SURF = window.__SB_SURFACE || "";
  var DATA = "https://raw.githubusercontent.com/NovaTerra123/" +
    "vinayaki-surfaces/data";
  var ISSUES_NEW = "https://github.com/NovaTerra123/" +
    "vinayaki-surfaces/issues/new";
  var ROOT = "/";
  try {
    var sp = new URL(document.currentScript.src).pathname;
    ROOT = sp.slice(0, sp.lastIndexOf("/") + 1);
  } catch (e) { /* keep / */ }
  var origFetch = window.fetch.bind(window);

  /* ---------------------------------------------------------- gate key -- */
  function gateKey() {
    try { return localStorage.getItem("sb_key") || ""; } catch (e) {
      return "";
    }
  }
  function gateRedirect() {
    try {
      location.replace(ROOT + "index.html?next=" +
        encodeURIComponent(location.pathname + location.search));
    } catch (e) { /* noop */ }
  }
  if (!gateKey() && !/\/index\.html$/.test(location.pathname) &&
      location.pathname !== ROOT) {
    gateRedirect();
    return;
  }

  /* ------------------------------------------------------------- crypto -- */
  var keysPromise = null;
  function deriveKeys() {
    if (keysPromise) return keysPromise;
    keysPromise = (async function () {
      var enc = new TextEncoder();
      var base = await crypto.subtle.importKey(
        "raw", enc.encode(gateKey()), "PBKDF2", false, ["deriveBits"]);
      var bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode("vinayaki-split-brain-v1"),
          iterations: 100000, hash: "SHA-256" }, base, 512);
      var master = new Uint8Array(bits);
      var encKey = await crypto.subtle.importKey(
        "raw", master.slice(0, 32), { name: "AES-CBC" }, false,
        ["encrypt", "decrypt"]);
      var macKey = await crypto.subtle.importKey(
        "raw", master.slice(32, 64),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      return { encKey: encKey, macKey: macKey };
    })();
    return keysPromise;
  }
  function b64encode(buf) {
    var bytes = new Uint8Array(buf), s = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(
        null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(s);
  }
  function b64decodeToBuf(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  async function decryptBytes(envText) {
    var env = JSON.parse(envText);
    var keys = await deriveKeys();
    var iv = new Uint8Array(b64decodeToBuf(env.iv));
    var ct = new Uint8Array(b64decodeToBuf(env.ct));
    var tag = b64decodeToBuf(env.tag);
    var signed = new Uint8Array(iv.length + ct.length);
    signed.set(iv); signed.set(ct, iv.length);
    var ok = await crypto.subtle.verify("HMAC", keys.macKey, tag, signed);
    if (!ok) throw new Error("bridge: bad key or corrupt payload");
    return crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, keys.encKey, ct);
  }
  async function decryptText(envText) {
    var buf = await decryptBytes(envText);
    return new TextDecoder().decode(buf);
  }
  async function encryptText(text) {
    var keys = await deriveKeys();
    var iv = crypto.getRandomValues(new Uint8Array(16));
    var ct = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: iv }, keys.encKey,
      new TextEncoder().encode(text));
    var ctU = new Uint8Array(ct);
    var signed = new Uint8Array(iv.length + ctU.length);
    signed.set(iv); signed.set(ctU, iv.length);
    var tag = await crypto.subtle.sign("HMAC", keys.macKey, signed);
    return JSON.stringify({ v: 1, iv: b64encode(iv.buffer),
      ct: b64encode(ct), tag: b64encode(tag) });
  }

  /* ------------------------------------------------------------ helpers -- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function snapKey(p) {
    return p.split("?")[0].replace(/^\//, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_");
  }
  function apiPath(u) {
    var m = u.pathname.match(
      /^\/(?:vinayaki-surfaces\/)?(?:dashboard|control|buddhi|studio|avatar)(\/api\/.*)$/) ||
      u.pathname.match(/^(\/api\/.*)$/);
    return m ? m[1] + (u.search || "") : null;
  }
  function resultToResponse(res) {
    var body = null, headers = {};
    if (res.body_b64) body = b64decodeToBuf(res.body_b64);
    else if (typeof res.body === "string") body = res.body;
    if (res.content_type) headers["Content-Type"] = res.content_type;
    headers["X-Bridge"] = "pages-rendezvous";
    return new Response(body, { status: res.status || 200, headers: headers });
  }
  function jsonResponse(code, obj) {
    return new Response(JSON.stringify(obj),
      { status: code, headers: { "Content-Type": "application/json" } });
  }

  /* ------------------------------------------- provenance chip ----- */
  var TYPE_STYLE = {
    MEASURED: ["MEASURED", "#57d98d"],
    AUTHORITY: ["AUTHORITY", "#e0b34e"],
    DECLARED_GRAMMAR: ["DECLARED GRAMMAR", "#9a86e8"],
    WISH: ["WISH", "#7fb3d9"]
  };
  var chipEl = null;
  function showProvenance(type, at) {
    var st = TYPE_STYLE[type];
    if (!st) return;
    function draw() {
      if (!chipEl) {
        chipEl = document.createElement("div");
        chipEl.style.cssText = "position:fixed;left:10px;bottom:10px;" +
          "z-index:99990;background:rgba(16,12,28,.88);color:#e9e4ff;" +
          "border:1px solid rgba(255,255,255,.18);border-radius:999px;" +
          "padding:4px 10px;font:11px/1.4 system-ui;letter-spacing:.02em";
        (document.body || document.documentElement).appendChild(chipEl);
      }
      var t = at ? String(at).slice(11, 19) + "Z" : "";
      chipEl.innerHTML = "";
      var dot = document.createElement("span");
      dot.textContent = "● ";
      dot.style.color = st[1];
      chipEl.appendChild(dot);
      chipEl.appendChild(document.createTextNode(
        "data " + st[0] + (t ? " · " + t : "") + " · via bridge"));
    }
    if (document.body) draw();
    else document.addEventListener("DOMContentLoaded", draw);
  }

  /* -------------------------------------------- sentinel badge ----- */
  async function sentinelBadge() {
    if (SURF !== "dashboard" && SURF !== "buddhi") return;
    try {
      var r = await origFetch(DATA + "/snap/" + SURF +
        "/api_sentinel.json", { cache: "no-store" });
      if (r.status !== 200) return;
      var env = JSON.parse(await decryptText(await r.text()));
      var doc = JSON.parse(env.body);
      var ex = (doc.exposures || []).filter(
        function (e) { return typeof e.days_remaining === "number"; });
      if (!ex.length) return;
      ex.sort(function (a, b) {
        return a.days_remaining - b.days_remaining; });
      var badge = document.createElement("div");
      badge.style.cssText = "position:fixed;right:10px;top:10px;" +
        "z-index:99990;background:rgba(16,12,28,.88);color:#e9e4ff;" +
        "border:1px solid rgba(255,255,255,.18);border-radius:10px;" +
        "padding:6px 10px;font:11px/1.5 system-ui;max-width:46vw";
      badge.title = "Peak Sentinel exposures (Kala register); " +
        "Pages data can lag 1-5 min (CDN)";
      badge.innerHTML = "";
      ex.slice(0, 3).forEach(function (e) {
        var row = document.createElement("div");
        row.textContent = "⏳ " + e.title + " — " +
          e.days_remaining + "d";
        if (e.in_warning_band) row.style.color = "#ffb35c";
        badge.appendChild(row);
      });
      badge.addEventListener("click", function () {
        if (badge.parentNode) badge.parentNode.removeChild(badge);
      });
      (document.body || document.documentElement).appendChild(badge);
    } catch (e) { /* badge is garnish; never break the surface */ }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sentinelBadge);
  } else { sentinelBadge(); }

  /* -------------------------------------------------------- GET bridge -- */
  async function bridgedGet(p) {
    if (p.indexOf("/api/stream") === 0) {
      return jsonResponse(404, { error: "sse_not_bridged_use_polling" });
    }
    if (SURF === "avatar" && p.indexOf("/api/file/") === 0) {
      var fid = p.slice("/api/file/".length).split("?")[0]
        .replace(/[^A-Za-z0-9_-]/g, "");
      var fr = await origFetch(DATA + "/files/" + fid + ".json",
        { cache: "no-store" });
      if (fr.status !== 200) return jsonResponse(404, { error: "no_file" });
      var rec = JSON.parse(await decryptText(await fr.text()));
      return new Response(b64decodeToBuf(rec.body_b64 || ""), {
        status: 200,
        headers: { "Content-Type":
          rec.content_type || "application/octet-stream" } });
    }
    var key = snapKey(p);
    var r = await origFetch(DATA + "/snap/" + SURF + "/" + key + ".json",
      { cache: "no-store" });
    if (r.status !== 200) return jsonResponse(404, { error: "no_snapshot" });
    var env = JSON.parse(await decryptText(await r.text()));
    showProvenance(env.tsync && env.tsync.type, env.fetched_at);
    var body = env.body;
    if (SURF === "buddhi" && key === "api_events" &&
        typeof body === "string") {
      var q = new URLSearchParams(p.split("?")[1] || "");
      var since = parseFloat(q.get("since") || "0");
      if (since > 0) {
        try {
          var feed = JSON.parse(body);
          feed.events = (feed.events || []).filter(
            function (ev) { return (ev.epoch || 0) > since; });
          body = JSON.stringify(feed);
        } catch (e) { /* serve unfiltered */ }
      }
    }
    var headers = { "Content-Type": env.content_type || "application/json",
                    "Cache-Control": "no-store" };
    if (env.fetched_at) headers["X-Snapshot-At"] = env.fetched_at;
    return new Response(typeof body === "string" ? body : JSON.stringify(body),
      { status: env.status || 200, headers: headers });
  }

  /* ------------------------------------------------------- POST bridge -- */
  function showActionOverlay(url) {
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:auto 12px 12px 12px;z-index:" +
      "99999;background:#141021;color:#f2ecff;border:1px solid #6d5bd0;" +
      "border-radius:14px;padding:14px 16px;font:14px/1.5 system-ui;" +
      "box-shadow:0 8px 32px rgba(0,0,0,.5)";
    box.innerHTML =
      "<b>Send this action through GitHub</b> (fallback bridge)<br>" +
      "1 · Tap the button — a prefilled, encrypted issue opens.<br>" +
      "2 · Tap <b>Submit</b> there. Nothing to type.<br>" +
      "3 · Keep this page open — the result returns here " +
      "(can take a few minutes).";
    var a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Open the prepared GitHub issue";
    a.style.cssText = "display:inline-block;margin:10px 10px 4px 0;" +
      "background:#6d5bd0;color:#fff;padding:9px 14px;border-radius:9px;" +
      "text-decoration:none;font-weight:600";
    var status = document.createElement("span");
    status.textContent = "Waiting for the VM…";
    var cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = "margin-left:10px;background:transparent;" +
      "color:#cbbfff;border:1px solid #6d5bd0;border-radius:9px;" +
      "padding:8px 12px";
    box.appendChild(a); box.appendChild(cancel);
    box.appendChild(document.createElement("br"));
    box.appendChild(status);
    (document.body || document.documentElement).appendChild(box);
    return { box: box, status: status,
             cancelled: false,
             cancelBtn: cancel };
  }

  async function bridgedPost(p, buf, contentType) {
    var id = Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);
    var action = { id: id, surface: SURF, method: "POST", path: p,
      content_type: contentType || "application/json",
      body_b64: b64encode(buf), ts: new Date().toISOString() };
    var envText = await encryptText(JSON.stringify(action));
    var url = ISSUES_NEW + "?title=" + encodeURIComponent("bridge-action") +
      "&body=" + encodeURIComponent(envText);
    var ui = showActionOverlay(url);
    var done = false;
    ui.cancelBtn.addEventListener("click", function () {
      ui.cancelled = true;
    });
    try {
      for (var i = 0; i < 200 && !ui.cancelled; i++) {  /* ~10 min */
        await sleep(3000);
        var rr;
        try {
          rr = await origFetch(DATA + "/results/" + id + ".json",
            { cache: "no-store" });
        } catch (e) { continue; }
        if (rr.status === 200) {
          var res = JSON.parse(await decryptText(await rr.text()));
          done = true;
          return resultToResponse(res);
        }
      }
      return jsonResponse(504, { ok: false,
        error: ui.cancelled ? "bridge_cancelled" : "bridge_timeout" });
    } finally {
      if (ui.box.parentNode) ui.box.parentNode.removeChild(ui.box);
    }
  }

  /* ---------------------------------------------------- asset bridges -- */
  function faceAssetPath(u) {
    if (u.pathname.indexOf("/assets/face/") < 0) return null;
    if (/\.(wasm|data|binarypb)$/.test(u.pathname)) return u.pathname;
    return null;
  }
  function dashAudioName(u) {
    if (u.pathname.indexOf("/assets/bija/") >= 0 ||
        u.pathname.indexOf("/assets/voices/") >= 0) {
      return u.pathname.split("/").pop();
    }
    return null;
  }
  /* Oversize payloads (go-live finding): the connector push path
   * refuses bodies above ~2.3-5.3 MB, so assemble_pages.py splits
   * text payloads over 2 MB into <name>.pNN parts of 1.5 MB.
   * fetchTextMaybeChunked fetches the plain file; on 404 it joins
   * the parts in order until a part 404s. Returns null when neither
   * exists. */
  async function fetchTextMaybeChunked(url) {
    var r = await origFetch(url, { cache: "force-cache" });
    if (r.status === 200) return await r.text();
    var parts = [];
    for (var i = 0; i < 64; i++) {
      var pr = await origFetch(url + ".p" + (i < 10 ? "0" : "") + i,
        { cache: "force-cache" });
      if (pr.status !== 200) break;
      parts.push(await pr.text());
    }
    return parts.length ? parts.join("") : null;
  }
  async function assetResponse(u) {
    var face = faceAssetPath(u);
    if (face) {
      var text = await fetchTextMaybeChunked(
        ROOT.replace(/\/$/, "") + face + ".b64");
      if (text === null) return new Response("", { status: 404 });
      var buf = b64decodeToBuf(text.trim());
      return new Response(buf, { status: 200, headers: {
        "Content-Type": face.slice(-5) === ".wasm"
          ? "application/wasm" : "application/octet-stream" } });
    }
    var name = dashAudioName(u);
    if (name) {
      var encText = await fetchTextMaybeChunked(
        ROOT + "media/" + name + ".enc");
      if (encText === null) return new Response("", { status: 404 });
      var bytes = await decryptBytes(encText);
      return new Response(bytes, { status: 200, headers: {
        "Content-Type": name.slice(-5) === ".opus"
          ? "audio/ogg" : "audio/wav" } });
    }
    return null;
  }

  /* --------------------------------------------------------- fetch hook -- */
  window.fetch = async function (input, init) {
    var req;
    try { req = new Request(input, init); }
    catch (e) { return origFetch(input, init); }
    var u;
    try { u = new URL(req.url, location.href); }
    catch (e) { return origFetch(input, init); }
    if (u.origin !== location.origin) return origFetch(input, init);
    if (req.method === "GET" || req.method === "HEAD") {
      var asset = await assetResponse(u);
      if (asset) return asset;
    }
    var p = apiPath(u);
    if (!p) return origFetch(input, init);
    if (req.method === "GET" || req.method === "HEAD") return bridgedGet(p);
    var buf = await req.clone().arrayBuffer();
    return bridgedPost(p, buf, req.headers.get("content-type"));
  };

  /* ----------------------------------------------------------- XHR hook -- */
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__sb = null;
    try {
      var u = new URL(url, location.href);
      if (u.origin === location.origin) {
        var p = apiPath(u);
        if (p) {
          this.__sb = { kind: "api",
            method: (method || "GET").toUpperCase(), p: p };
        } else if (faceAssetPath(u) || dashAudioName(u)) {
          this.__sb = { kind: "asset", url: u };
        }
      }
    } catch (e) { /* fall through */ }
    if (!this.__sb) return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (!this.__sb) return XS.apply(this, arguments);
    var xhr = this, sb = this.__sb;
    function emit(status, buf, text) {
      Object.defineProperty(xhr, "readyState",
        { value: 4, configurable: true });
      Object.defineProperty(xhr, "status",
        { value: status, configurable: true });
      var rt = xhr.responseType || "";
      var resp = buf;
      if (rt === "" || rt === "text") {
        resp = (text != null) ? text : "";
        Object.defineProperty(xhr, "responseText",
          { value: resp, configurable: true });
      } else if (rt === "blob") {
        resp = new Blob([buf]);
      }
      Object.defineProperty(xhr, "response",
        { value: resp, configurable: true });
      if (xhr.onreadystatechange) xhr.onreadystatechange();
      if (xhr.onload) xhr.onload();
      try { xhr.dispatchEvent(new Event("load")); } catch (e) {}
      try { xhr.dispatchEvent(new Event("loadend")); } catch (e) {}
    }
    (async function () {
      try {
        if (sb.kind === "asset") {
          var ar = await assetResponse(sb.url);
          if (!ar) { emit(404, new ArrayBuffer(0)); return; }
          emit(ar.status, await ar.arrayBuffer());
        } else if (sb.method === "GET") {
          var r = await bridgedGet(sb.p);
          emit(r.status, null, await r.text());
        } else {
          var buf = new ArrayBuffer(0);
          if (typeof body === "string")
            buf = new TextEncoder().encode(body).buffer;
          else if (body instanceof ArrayBuffer) buf = body;
          var resp2 = await bridgedPost(sb.p, buf, "application/json");
          emit(resp2.status, null, await resp2.text());
        }
      } catch (e) { emit(0, new ArrayBuffer(0)); if (xhr.onerror) xhr.onerror(e); }
    })();
  };

  /* EventSource stub: fail fast so SSE pages use their polling fallback. */
  window.EventSource = function (url) {
    this.url = url; this.readyState = 0;
    this.onmessage = null; this.onerror = null; this.onopen = null;
    var self = this, n = 0;
    var iv = setInterval(function () {
      n++; self.readyState = 2;
      if (self.onerror) { try { self.onerror(new Event("error")); } catch (e) {} }
      if (n >= 3) clearInterval(iv);
    }, 300);
    this.close = function () { clearInterval(iv); };
    this.addEventListener = function () {};
    this.removeEventListener = function () {};
    this.dispatchEvent = function () { return false; };
  };
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;
})();
