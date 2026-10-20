// J-Veraxs relay: receives HTTP commands from XToys and pushes them in real time
// to the bridge page over a WebSocket. Everything lives under /<SECRET>/...
//
//   GET  /<SECRET>/         -> the bridge page (open this in Bluefy)
//   GET  /<SECRET>/ws       -> WebSocket the bridge page connects to
//   POST /<SECRET>/cmd      -> command from XToys (any JSON / form / text body)
//   GET  /<SECRET>/cmd?...  -> same, handy for testing from a normal browser
//   GET  /<SECRET>/status   -> how many bridge pages are connected

import { DurableObject } from "cloudflare:workers";
import BRIDGE_HTML from "../../bridge/index.html";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const MAX_BODY = 8192;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(msg, status) {
  return new Response(msg, { status, headers: { ...CORS, "Content-Type": "text/plain" } });
}

// Constant-time string comparison so the secret can't be guessed by timing.
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (!env.SECRET || env.SECRET.length < 12) {
      return text("Relay is not set up yet: add a secret named SECRET (at least 12 characters) in the Worker settings.", 500);
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(START_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }

    const parts = url.pathname.split("/");
    let key = "";
    try {
      key = decodeURIComponent(parts[1] || "");
    } catch {}
    const action = parts[2];

    if (!safeEqual(key, env.SECRET) || parts.length > 3) return text("Not found", 404);

    if (action === undefined) {
      // "/<SECRET>" -> "/<SECRET>/" so the page's relative paths work.
      return Response.redirect(`${url.origin}${url.pathname}/`, 301);
    }

    if (action === "") {
      const page = BRIDGE_HTML.replace("/*RELAY_AUTOCONFIG*/", "window.SERVED_BY_RELAY = true;");
      return new Response(page, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    if (action === "ws" || action === "cmd" || action === "status") {
      const stub = env.RELAY.get(env.RELAY.idFromName("main"));
      return stub.fetch(request);
    }

    return text("Not found", 404);
  },
};

// Start page at "/": type the key into a box instead of into the address bar
// (some browsers, e.g. Bluefy, treat long pasted addresses as a search).
// It reveals nothing; a wrong key just leads to "Not found".
const START_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>J-Veraxs Bridge</title>
<style>
  body { margin: 0; background: #111318; color: #e9ecf1; font: 17px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 32px 16px; }
  input, button { width: 100%; box-sizing: border-box; font: inherit; padding: 14px; border-radius: 12px; margin-top: 10px; }
  input { border: 1px solid #2c313b; background: #0d0f13; color: #e9ecf1; }
  button { border: 0; background: #7c8cff; color: #fff; font-weight: 600; }
  label { display: flex; gap: 10px; align-items: center; margin-top: 14px; color: #9aa3b2; }
  label input { width: 22px; height: 22px; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>J-Veraxs Bridge</h1>
  <form id="f">
    <input id="key" type="password" placeholder="Your secret key" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required>
    <label><input type="checkbox" id="remember"> Remember the key on this phone</label>
    <button>Open bridge</button>
  </form>
</main>
<script>
  const k = document.getElementById("key"), r = document.getElementById("remember");
  try { const saved = localStorage.getItem("bridgeKey"); if (saved) { k.value = saved; r.checked = true; } } catch {}
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = k.value.trim();
    try { if (r.checked) localStorage.setItem("bridgeKey", key); else localStorage.removeItem("bridgeKey"); } catch {}
    location.href = "/" + encodeURIComponent(key) + "/";
  });
</script>
</body>
</html>`;

// Turns whatever XToys sends into one flat object. URL query parameters
// (e.g. ?ch=suction) are merged in, and the body wins on conflicts.
async function parseCommand(request, url, body) {
  const cmd = {};
  for (const [k, v] of url.searchParams) cmd[k] = v;

  if (request.method === "POST") {
    if (body) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        const pair = body.match(/^(-?[\d.]+)\s*,\s*(\d+)$/);
        if (pair) parsed = { vibrate: pair[1], channel: pair[2] }; // "<<vibrate>>,<<channel>>"
        else parsed = body.includes("=") ? Object.fromEntries(new URLSearchParams(body)) : body;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(cmd, parsed);
      else cmd.value = parsed;
    }
  }
  return cmd;
}

// A single Durable Object holds the bridge page's WebSocket(s) and fans
// commands out to them. Uses the hibernation API so idle time costs nothing.
export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answer the bridge's keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/")[2];

    if (action === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") return text("Expected a WebSocket", 426);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (action === "status") {
      const now = Date.now();
      const recent = ((await this.ctx.storage.get("recent")) || []).map((r) => ({
        secondsAgo: Math.round((now - r.t) / 1000),
        ...r,
      }));
      return json({ ok: true, bridges: this.ctx.getWebSockets().length, recent });
    }

    const body = request.method === "POST" ? (await request.text()).slice(0, MAX_BODY).trim() : "";
    const cmd = await parseCommand(request, url, body);

    // Keep the last few requests (with the raw body) so /status can show
    // what XToys actually sent, even if the bridge page was asleep.
    const recent = (await this.ctx.storage.get("recent")) || [];
    recent.unshift({
      t: Date.now(),
      method: request.method,
      contentType: request.headers.get("Content-Type") || "",
      origin: request.headers.get("Origin") || "",
      query: url.search,
      body: body.slice(0, 500),
    });
    await this.ctx.storage.put("recent", recent.slice(0, 10));

    const msg = JSON.stringify({ type: "cmd", cmd, t: Date.now() });
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
        sent++;
      } catch {}
    }
    return json({ ok: sent > 0, bridges: sent, received: cmd });
  }

  webSocketMessage() {}

  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {}
  }

  webSocketError(ws) {
    try {
      ws.close(1011, "error");
    } catch {}
  }
}
