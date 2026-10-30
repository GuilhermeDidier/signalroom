"use client";

import { useEffect, useRef, useState } from "react";
import { Alarm } from "@/components/Lamp";
import { Empty, View } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { DocStatus, DocumentRow } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

const STEPS: DocStatus[] = ["queued", "parsing", "chunking", "embedding", "indexed"];
const ACCEPT = ".pdf,.docx,.txt,.md";
type Live = "connecting" | "live" | "retrying";

export function Documents() {
  const { tid, can } = useTenant();
  const res = useResource(() => api.documents(tid), [tid]);
  const [live, setLive] = useState<Live>("connecting");
  const { setData } = res;

  // Live pipeline status over fetch-based SSE (Bearer header), reconnecting with backoff.
  useEffect(() => {
    const ctrl = new AbortController();
    let attempt = 0;
    (async () => {
      while (!ctrl.signal.aborted) {
        try {
          await api.documentEvents(
            tid,
            (docs) => {
              attempt = 0;
              setLive("live");
              setData(() => docs);
            },
            ctrl.signal,
          );
        } catch {
          // stream dropped; retry below
        }
        if (ctrl.signal.aborted) return;
        setLive("retrying");
        attempt += 1;
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** attempt)));
      }
    })();
    return () => ctrl.abort();
  }, [tid, setData]);

  const upsert = (row: DocumentRow) =>
    setData((prev) => (prev ? [row, ...prev.filter((d) => d.id !== row.id)] : [row]));

  return (
    <>
      {can.manageDocuments ? (
        <AddSources onAdded={upsert} />
      ) : (
        <p className="notice-line">
          Your role can read the knowledge base. Owners and admins add, re-index or delete documents.
        </p>
      )}
      <section className="panel" aria-labelledby="kb-h">
        <div className="panel__head">
          <h2 id="kb-h" className="engraved">Knowledge base</h2>
          <span className={`livetag livetag--${live}`}>
            <span className="livetag__led" aria-hidden="true" />
            {live === "live" ? "Live status" : live === "retrying" ? "Reconnecting…" : "Connecting…"}
          </span>
        </div>
        <View
          res={res}
          loadingRows={6}
          isEmpty={(d) => d.length === 0}
          empty={
            <Empty title="No documents yet">
              {can.manageDocuments
                ? "Drop a PDF, DOCX, TXT or Markdown file above, or add a help-center URL. The assistant answers only from what's here."
                : "An owner or admin needs to add help articles before the assistant can answer."}
            </Empty>
          }
        >
          {(docs) => (
            <ul className="doclist">
              {docs.map((d) => (
                <DocRow key={d.id} d={d} canManage={can.manageDocuments} onChanged={res.reload} />
              ))}
            </ul>
          )}
        </View>
      </section>
    </>
  );
}

function AddSources({ onAdded }: { onAdded: (d: DocumentRow) => void }) {
  const { tid } = useTenant();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const f of Array.from(files)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "docx", "txt", "md"].includes(ext)) {
        setError(`${f.name}: upload a PDF, DOCX, TXT or MD file.`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} is over 10 MB.`);
        continue;
      }
      setBusy(f.name);
      try {
        onAdded(await api.uploadDocument(tid, f));
      } catch (e) {
        setError(e instanceof ApiError ? `${f.name}: ${e.message}` : `${f.name} wasn't uploaded.`);
      }
    }
    setBusy(null);
  }

  return (
    <section className="add">
      <div
        className={`drop${drag ? " is-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
      >
        <svg className="drop__icon" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M11 6h13l8 8v20H11z" fill="#fff" stroke="#7d8da0" strokeWidth="1.6" />
          <path d="M24 6v8h8" fill="none" stroke="#7d8da0" strokeWidth="1.6" />
          <path d="M21.5 30V19m-4.5 4.5 4.5-4.5 4.5 4.5" fill="none" stroke="#1c4fb8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="drop__text">
          <p className="drop__title">{busy ? `Uploading ${busy}…` : "Drop help articles here"}</p>
          <p className="hint">PDF, DOCX, TXT or MD · up to 10 MB each</p>
        </div>
        <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => input.current?.click()}>
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <form
        className="addurl"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(url);
          try {
            onAdded(await api.addUrl(tid, url.trim()));
            setUrl("");
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "That URL wasn't added.");
          } finally {
            setBusy(null);
          }
        }}
      >
        <label className="field">
          <span>Add a web page</span>
          <input
            className="input"
            type="url"
            required
            placeholder="https://help.example.com/returns"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button className="btn" type="submit" disabled={busy !== null}>
          Add URL
        </button>
      </form>
      {error && (
        <p className="form-error add__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function DocRow({ d, canManage, onChanged }: { d: DocumentRow; canManage: boolean; onChanged: () => void }) {
  const { tid } = useTenant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = d.status === "failed";
  const idx = failed ? -1 : STEPS.indexOf(d.status);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li id={`doc-${d.id}`} className={`doc${failed ? " is-failed" : ""}`}>
      <div className="doc__main">
        <p className="doc__title">
          <span className="chip">{d.source_type.toUpperCase()}</span> {d.title}
        </p>
        <p className="doc__sub">
          {d.source_url ? (
            <a href={d.source_url} target="_blank" rel="noreferrer noopener" className="mono">
              {d.source_url}
            </a>
          ) : null}
          <span>updated {timeAgo(d.updated_at)}</span>
          {d.status === "indexed" && <span className="kbd-num">{d.chunk_count} chunks</span>}
        </p>
      </div>
      <div className="doc__pipe">
        {failed ? (
          <div className="doc__fail">
            <Alarm>Failed{d.attempts ? ` after ${d.attempts} attempt${d.attempts > 1 ? "s" : ""}` : ""}</Alarm>
            <p className="doc__error">{d.error ?? "Ingestion failed."}</p>
          </div>
        ) : (
          <ol className="stepper" aria-label={`Pipeline: ${d.status}`}>
            {STEPS.map((s, i) => {
              const state = i < idx || d.status === "indexed" ? "done" : i === idx ? "active" : "todo";
              return (
                <li key={s} className={`step step--${state}`} aria-current={state === "active" ? "step" : undefined}>
                  <span className="step__led" aria-hidden="true" />
                  <span className="step__label">{s}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {canManage && (
        <div className="doc__actions">
          <button className="btn btn--ghost btn--sm" disabled={busy || (!failed && d.status !== "indexed")} onClick={() => act(() => api.reindex(tid, d.id))}>
            {failed ? "Retry" : "Re-index"}
          </button>
          <button
            className="btn btn--danger btn--sm"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete “${d.title}” and its ${d.chunk_count} chunks? The assistant stops citing it immediately.`)) {
                act(() => api.deleteDocument(tid, d.id));
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
      {error && (
        <p className="form-error doc__err" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
