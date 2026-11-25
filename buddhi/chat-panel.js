/* Buddhi chat panel — reference implementation, cycle #3 wave 1.
 * CONTRACT (surfaces lane: copy this file + chat-panel.css verbatim):
 *   Endpoints (8794 origin): POST /api/chat {surface, message, context_event_id?}
 *                            GET  /api/chat/history
 *   Base URL: window.BUDDHI_CHAT_BASE or (protocol//hostname:8794).
 *   Mount point: an element with id="buddhi-chat-mount"; this script
 *   renders the panel inside it. Surface name: window.BUDDHI_CHAT_SURFACE
 *   or the current page's port. Shared history: the service keys the
 *   thread to the bus, so every surface sees the same thread.
 *   Honesty: pending state is real (shown from send until the reply
 *   event returns); a failed/down lane says DOWN in words; no canned
 *   text is ever rendered as a reply.
 */
(function () {
  var base = window.BUDDHI_CHAT_BASE ||
    (location.protocol + "//" + location.hostname + ":8794");
  var surface = window.BUDDHI_CHAT_SURFACE || ("principal-via-" + location.port);
  var mount = document.getElementById("buddhi-chat-mount");
  if (!mount) return;
  mount.innerHTML =
    '<div class="buddhi-chat"><h3>Talk to Buddhi</h3>' +
    '<p class="bc-sub">One shared conversation across all five surfaces. ' +
    'Every message and reply is a recorded event on the bus — the ids are shown.</p>' +
    '<div class="bc-thread" id="bcThread"></div>' +
    '<div class="bc-status" id="bcStatus"></div>' +
    '<form id="bcForm"><input type="text" id="bcInput" autocomplete="off" ' +
    'placeholder="Ask about a gate, a job, an event (bev-…), or the state of the work">' +
    '<button type="submit" id="bcSend">Send</button></form></div>';
  var thread = document.getElementById("bcThread");
  var status = document.getElementById("bcStatus");
  var input = document.getElementById("bcInput");
  var sendBtn = document.getElementById("bcSend");
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function addMsg(role, text, meta) {
    var div = document.createElement("div");
    div.className = "bc-msg " + role;
    div.innerHTML = esc(text) + (meta ? '<div class="bc-meta">' + esc(meta) + "</div>" : "");
    thread.appendChild(div); thread.scrollTop = thread.scrollHeight;
    return div;
  }
  function loadHistory() {
    fetch(base + "/api/chat/history").then(function (r) { return r.json(); })
      .then(function (d) {
        thread.innerHTML = "";
        (d.thread || []).forEach(function (m) {
          addMsg(m.role, m.text, m.event_id + " · " + (m.ts || ""));
        });
        if (!(d.thread || []).length)
          status.innerHTML = '<span class="bc-pending">No messages yet in the shared thread.</span>';
      })
      .catch(function () {
        status.innerHTML = '<span class="bc-down">Chat lane is DOWN — the history could not be loaded from the 8794 service. Nothing is hidden; the panel will work when the service answers.</span>';
      });
  }
  document.getElementById("bcForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var msg = input.value.trim(); if (!msg) return;
    input.value = ""; sendBtn.disabled = true;
    addMsg("principal", msg, "sending…");
    status.innerHTML = '<span class="bc-pending">Waiting for Buddhi — the reply is being produced from the live record…</span>';
    var ctx = window.BUDDHI_CHAT_CONTEXT_EVENT_ID || null;
    fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: surface, message: msg, context_event_id: ctx }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        sendBtn.disabled = false;
        if (!res.ok || !res.d.ok) {
          status.innerHTML = '<span class="bc-down">Chat lane is DOWN — ' + esc((res.d && res.d.error) || "the service did not answer") + ". Your message was not answered and no reply has been invented.</span>";
          return;
        }
        status.innerHTML = "";
        addMsg("buddhi", res.d.reply_text,
          res.d.reply_event_id + " · in reply to " + res.d.message_event_id + " · " + res.d.latency_ms + " ms");
      })
      .catch(function (e) {
        sendBtn.disabled = false;
        status.innerHTML = '<span class="bc-down">Chat lane is DOWN — the 8794 service could not be reached (' + esc(e) + "). No reply has been invented.</span>";
      });
  });
  loadHistory();
})();
