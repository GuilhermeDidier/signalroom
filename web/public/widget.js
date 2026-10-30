/*! Signalroom widget — vanilla, no dependencies.
 * <script src="https://<web>/widget.js" data-key="pk_..." async></script>
 * Injects a chat launcher and an iframe pointing at <web>/embed?key=...
 * API: window.Signalroom.open() / .close() / .toggle() / .ask("question") / .destroy()
 *      window.Signalroom.key is the data-key of the mounted widget.
 * One widget per page: loading the same key again is a no-op; a script with a
 * different key (a single-page app switching tenant) replaces the current widget.
 * A script tag removed before it ran (e.g. the page that added it unmounted) mounts nothing.
 */
(function () {
  "use strict";
  var scripts = document.querySelectorAll('script[src*="widget.js"][data-key]');
  var script = document.currentScript || scripts[scripts.length - 1];
  if (!script || !script.isConnected) return;
  var key = script.getAttribute("data-key");
  if (!key) return console.warn("[signalroom] missing data-key on the script tag");
  if (window.Signalroom) {
    if (window.Signalroom.key === key) return;
    if (typeof window.Signalroom.destroy === "function") window.Signalroom.destroy();
  }
  var origin = new URL(script.src, location.href).origin;
  var color = "#1f5fd1";
  var isOpen = false;
  var ready = false;
  var queue = [];

  var host = document.createElement("div");
  host.setAttribute("data-signalroom", "");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial}" +
    ".sr-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:60px;height:60px;border:0;border-radius:50%;" +
    "background:var(--sr,#1f5fd1);color:#fff;cursor:pointer;display:grid;place-items:center;" +
    "box-shadow:0 6px 20px rgba(15,25,40,.28),0 2px 4px rgba(15,25,40,.2);transition:transform .15s ease}" +
    ".sr-btn:hover{transform:scale(1.06)}.sr-btn:focus-visible{outline:3px solid #2f6be0;outline-offset:3px}" +
    ".sr-btn svg{width:28px;height:28px}.sr-btn .sr-x{display:none}" +
    ".sr-open .sr-btn .sr-chat{display:none}.sr-open .sr-btn .sr-x{display:block}" +
    ".sr-panel{position:fixed;right:20px;bottom:92px;z-index:2147483647;width:390px;height:min(640px,calc(100vh - 116px));" +
    "border-radius:16px;overflow:hidden;background:#f6f8fb;box-shadow:0 18px 50px rgba(15,25,40,.3),0 0 0 1px rgba(15,25,40,.08);" +
    "opacity:0;transform:translateY(12px) scale(.98);transform-origin:bottom right;pointer-events:none;visibility:hidden;" +
    "transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}" +
    ".sr-open .sr-panel{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .18s ease,transform .18s ease}" +
    ".sr-panel iframe{width:100%;height:100%;border:0;display:block}" +
    "@media (max-width:480px){.sr-panel{inset:0;width:100%;height:100%;border-radius:0}.sr-open .sr-btn{display:none}}" +
    "@media (prefers-reduced-motion:reduce){.sr-panel,.sr-btn{transition:none}}";

  var wrap = document.createElement("div");
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sr-btn";
  btn.setAttribute("aria-label", "Open support chat");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML =
    '<svg class="sr-chat" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9.4L5 20.6V17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>' +
    '<svg class="sr-x" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';

  var panel = document.createElement("div");
  panel.className = "sr-panel";
  var frame = document.createElement("iframe");
  frame.title = "Support chat";
  frame.src = origin + "/embed?key=" + encodeURIComponent(key) + "&host=" + encodeURIComponent(location.origin);
  frame.setAttribute("allow", "clipboard-write");
  panel.appendChild(frame);

  wrap.appendChild(panel);
  wrap.appendChild(btn);
  root.appendChild(style);
  root.appendChild(wrap);

  function post(msg) {
    if (!ready) return queue.push(msg);
    frame.contentWindow.postMessage(msg, origin);
  }
  function setOpen(next) {
    isOpen = next;
    wrap.className = next ? "sr-open" : "";
    btn.setAttribute("aria-expanded", String(next));
    btn.setAttribute("aria-label", next ? "Close support chat" : "Open support chat");
    if (next) {
      post({ type: "signalroom:open" });
      setTimeout(function () { frame.focus(); }, 60);
    } else {
      btn.focus();
    }
  }
  btn.addEventListener("click", function () { setOpen(!isOpen); });

  function onMessage(e) {
    if (e.origin !== origin || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.type === "signalroom:ready") {
      ready = true;
      while (queue.length) frame.contentWindow.postMessage(queue.shift(), origin);
    } else if (d.type === "signalroom:config") {
      if (/^#[0-9a-fA-F]{6}$/.test(d.brand_color || "")) {
        color = d.brand_color;
        wrap.style.setProperty("--sr", color);
      }
    } else if (d.type === "signalroom:close") {
      setOpen(false);
    }
  }
  window.addEventListener("message", onMessage);

  function mount() { document.body.appendChild(host); }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  var api = {
    key: key,
    destroy: function () {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("DOMContentLoaded", mount);
      if (host.parentNode) host.parentNode.removeChild(host); // removes the iframe too
      queue = [];
      if (window.Signalroom === api) delete window.Signalroom;
    },
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!isOpen); },
    ask: function (text) {
      setOpen(true);
      post({ type: "signalroom:ask", text: String(text).slice(0, 2000) });
    },
  };
  window.Signalroom = api;
})();
