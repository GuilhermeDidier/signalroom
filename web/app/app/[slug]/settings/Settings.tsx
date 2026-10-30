"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Lamp } from "@/components/Lamp";
import { Loading } from "@/components/States";
import { api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { lampLevel } from "@/lib/lamp";
import { useTenant } from "@/lib/tenant-context";
import type { Tenant } from "@/lib/types";

const SAMPLES = [
  { c: 0.91, q: "How do I store the battery in winter?" },
  { c: 0.68, q: "Does the warranty cover a crash?" },
  { c: 0.57, q: "Can I fit a child seat on the rack?" },
  { c: 0.41, q: "Is the motor legal in Switzerland?" },
  { c: 0.15, q: "Can I ride through a river?" },
];

export function Settings() {
  const { tenant } = useTenant();
  if (!tenant) return <Loading rows={8} />;
  return <SettingsForm key={tenant.id} tenant={tenant} />;
}

function SettingsForm({ tenant }: { tenant: Tenant }) {
  const { tid, can, setTenant } = useTenant();
  const [threshold, setThreshold] = useState(tenant.confidence_threshold);
  const [origins, setOrigins] = useState(tenant.allowed_origins.join("\n"));
  const [color, setColor] = useState(tenant.brand_color);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const readOnly = !can.editSettings;
  const validColor = /^#[0-9a-fA-F]{6}$/.test(color);
  const snippet = `<script src="${WEB_URL}/widget.js" data-key="${tenant.widget_key}" async></script>`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!validColor) {
      setMsg({ ok: false, text: "Brand color must be a hex value like #0f7b6c." });
      return;
    }
    const list = origins
      .split(/[\s,]+/)
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const bad = list.find((o) => !/^https?:\/\/[^/\s]+$/.test(o));
    if (bad) {
      setMsg({ ok: false, text: `“${bad}” isn't an origin. Use the form https://shop.example.com (no path).` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const t = await api.updateSettings(tid, { confidence_threshold: Math.round(threshold * 100) / 100, allowed_origins: list, brand_color: color });
      setTenant(t);
      setMsg({ ok: true, text: "Settings saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Settings not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings" onSubmit={save}>
      {readOnly && <p className="notice-line">Only the workspace owner can change these settings. You&apos;re seeing them read-only.</p>}

      <section className="panel settings__threshold" aria-labelledby="th-h">
        <div className="settings__thcontrol">
          <h2 id="th-h" className="engraved">Confidence threshold</h2>
          <p className="th-value kbd-num">{threshold.toFixed(2)}</p>
          <input
            type="range"
            min={0.2}
            max={0.9}
            step={0.01}
            value={threshold}
            disabled={readOnly}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="range"
            aria-describedby="th-help"
          />
          <p id="th-help" className="hint">
            Answers scoring below {threshold.toFixed(2)} are escalated to a person instead of shown as final. Raise it to
            escalate more; lower it to let the AI answer more on its own.
          </p>
        </div>
        <div className="well settings__preview" aria-live="polite">
          <p className="engraved">Preview — same answers, this threshold</p>
          <ul className="preview">
            {SAMPLES.map((s) => {
              const lv = lampLevel(s.c, threshold);
              return (
                <li key={s.q} className={lv === "red" ? "is-alarm" : ""}>
                  <Lamp confidence={s.c} threshold={threshold} size="md" />
                  <span className="preview__q">{s.q}</span>
                  <span className="preview__out">{lv === "red" ? "→ human" : "AI answers"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <div className="split split--even">
        <section className="panel" aria-labelledby="org-h">
          <h2 id="org-h" className="engraved">Allowed origins</h2>
          <p className="hint">Sites allowed to load your widget. One per line.</p>
          <textarea
            className="textarea mono"
            rows={4}
            value={origins}
            disabled={readOnly}
            onChange={(e) => setOrigins(e.target.value)}
            aria-labelledby="org-h"
          />
        </section>
        <section className="panel" aria-labelledby="color-h">
          <h2 id="color-h" className="engraved">Brand color</h2>
          <p className="hint">Used for the chat button and the visitor&apos;s messages.</p>
          <div className="colorrow">
            <input
              type="color"
              value={validColor ? color : "#1f5fd1"}
              disabled={readOnly}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Pick brand color"
            />
            <input className="input mono" value={color} disabled={readOnly} onChange={(e) => setColor(e.target.value)} aria-label="Brand color hex" />
            <span className="launcher-preview" style={{ background: validColor ? color : "#1f5fd1" }} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M4 5h16v11H9l-5 4z" fill="#fff" />
              </svg>
            </span>
          </div>
        </section>
      </div>

      {!readOnly && (
        <div className="savebar">
          {msg && <p className={msg.ok ? "ok-line" : "form-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}

      <section className="panel" aria-labelledby="embed-h">
        <div className="panel__head">
          <h2 id="embed-h" className="engraved">Embed the widget</h2>
          <CopyButton text={snippet} label="Copy snippet" />
        </div>
        <p className="hint">Paste before the closing &lt;/body&gt; tag of any page on an allowed origin.</p>
        <pre className="snippet">
          <code>{snippet}</code>
        </pre>
        <p className="hint">
          Publishable key <code className="mono">{tenant.widget_key}</code> — safe to expose; it only allows chatting
          with this workspace&apos;s assistant.
        </p>
      </section>
    </form>
  );
}
