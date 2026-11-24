/* Split-brain bridge shim — GITHUB PAGES EDITION (showcase form).
 * Loaded in <head> of every hosted surface page (fallback hosting).
 *
 * GATE REMOVED — principal's ruling, 2026-11-23: "hosted pages open
 * freely, live data stays on my VM surfaces only." The access-key
 * gate, the encrypted-snapshot fetch/decrypt path, and the encrypted
 * issue write-back that used to live here are GONE from the hosted
 * edition. Nothing on this host is locked, and nothing here is
 * unlocked: the live programme data simply never travels to public
 * hosting any more. The VM surfaces (ports 8791-8796 at home) remain
 * the only place live data is served.
 *
 * What this shim still does, all of it local to the page:
 *   - Binary library assets (MediaPipe .wasm/.data/.binarypb) are
 *     stored as .b64 text (the GitHub push path is UTF-8 only) and
 *     decoded in-page — the avatar's camera work is client-side and
 *     needs no key and no server.
 *   - Every /api/ call is answered locally with a clean no-data
 *     response, so each surface renders its own designed empty state
 *     instead of firing real requests at a static host (no broken
 *     fetches, no error spam). Writes get an explicit read-only
 *     answer: this edition is a showcase.
 *   - Dashboard audio paths (the principal's own recordings) are
 *     answered 404: the recordings live only on the VM now — they
 *     are no longer ferried here in encrypted form — and the
 *     dashboard's own decode-failure path keeps the figure veiled,
 *     as its design requires ("a silent presentation is not
 *     allowed"). Silence is never passed off as the recordings.
 *   - EventSource is stubbed to fail fast so Buddhi Live uses its
 *     built-in polling fallback, which the fetch hook above serves
 *     locally.
 * The Anahata probe block below is retained verbatim: it is
 * test-locked identical across both editions' shims
 * (tests/test_anahata_probe.mjs) and is inert here — with no bridge
 * payloads on this host there is nothing for it to verdict. */
(function () {
  "use strict";
  var SURF = window.__SB_SURFACE || "";
  var ROOT = "/";
  try {
    var sp = new URL(document.currentScript.src).pathname;
    ROOT = sp.slice(0, sp.lastIndexOf("/") + 1);
  } catch (e) { /* keep / */ }
  var origFetch = window.fetch.bind(window);

/* === ANAHATA PROBE BLOCK (inline copies in both shims must match) === */
async function sbSha256Hex(text) {
  var buf = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(text));
  var bytes = new Uint8Array(buf), hex = "";
  for (var i = 0; i < bytes.length; i++) {
    hex += ("0" + bytes[i].toString(16)).slice(-2);
  }
  return hex;
}
function sbAnahataVerdict(claimed, receivedHex, opts) {
  opts = opts || {};
  if (!claimed || !receivedHex) return "unknown";
  if (opts.servedHex && receivedHex !== opts.servedHex) return "diverged";
  var basis = opts.servedHex || receivedHex;
  if (basis === claimed) return "reconciled";
  if (opts.transformed) return "transformed";
  return "diverged";
}
var SB_ANAHATA_MARK = {
  reconciled: ["✓", "#57d98d", "Anahata reconciled"],
  transformed: ["~", "#7fb3d9", "Anahata transformed (declared)"],
  diverged: ["✗", "#ff7a6b", "Anahata DIVERGED"],
  unknown: ["?", "#9a86e8", "Anahata unknown"]
};
/* === END ANAHATA PROBE BLOCK === */

  /* ------------------------------------------------------------ helpers -- */
  function b64decodeToBuf(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function jsonResponse(code, obj) {
    return new Response(JSON.stringify(obj),
      { status: code, headers: { "Content-Type": "application/json" } });
  }
  function apiPath(u) {
    var m = u.pathname.match(
      /^\/(?:vinayaki-surfaces\/)?(?:dashboard|control|buddhi|studio|avatar)(\/api\/.*)$/) ||
      u.pathname.match(/^(\/api\/.*)$/);
    return m ? m[1] + (u.search || "") : null;
  }

  /* ------------------------------------------- local API responder -- */
  /* The hosted edition carries no live data. GETs receive the clean
   * no-data answer the surfaces were built to render as empty states;
   * writes receive an explicit read-only answer. Both are produced
   * in-page: no request ever leaves for a static host that cannot
   * answer it. */
  function localApiResponse(method) {
    if (method === "GET" || method === "HEAD") {
      return jsonResponse(404, { error: "showcase_no_live_data" });
    }
    return jsonResponse(403, { ok: false, error: "showcase_read_only" });
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
    if (dashAudioName(u)) {
      /* The recordings are not on this host (see header). A clean
       * 404 lets the dashboard's designed decode-failure path keep
       * the figure veiled instead of presenting silence as audio. */
      return new Response("", { status: 404 });
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
    return localApiResponse(req.method);
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
        } else {
          var r = localApiResponse(sb.method);
          emit(r.status, null, await r.text());
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
