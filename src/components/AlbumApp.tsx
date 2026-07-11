"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  ConnectResponse,
  CreateAlbumResponse,
  KeyExpiredResponse,
  ProviderErrorResponse,
  SchemaResponse,
  StatusResponse,
  SweepResponse,
  UploadResponse,
} from "@/lib/api-types";
import type { AiProvider } from "@/lib/config";
import type { Album, ImageRecord } from "@/lib/types";
import { UNCLASSIFIED_ALBUM } from "@/lib/types";

type StatusMessage = { kind: "success" | "error"; text: string };

/** An upload that's stored but not yet filed anywhere, waiting on one of three user choices. */
type PendingResolution = {
  kind: "key_expired" | "provider_error";
  filename: string;
  url: string;
  provider: AiProvider;
  message: string;
};

function asPendingResolution(data: unknown): PendingResolution | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (d.error !== "key_expired" && d.error !== "provider_error") return null;
  if (typeof d.filename !== "string" || typeof d.url !== "string" || typeof d.message !== "string") return null;
  if (d.provider !== "anthropic" && d.provider !== "openai") return null;

  return { kind: d.error, filename: d.filename, url: d.url, provider: d.provider, message: d.message };
}

const HOME = "home";

export default function AlbumApp() {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [aiStatus, setAiStatus] = useState<StatusResponse | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<string>(HOME);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const adminDialogRef = useRef<HTMLDialogElement | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminApiKey, setAdminApiKey] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [resolutionDialogOpen, setResolutionDialogOpen] = useState(false);
  const resolutionDialogRef = useRef<HTMLDialogElement | null>(null);
  const [resolutionBusy, setResolutionBusy] = useState(false);

  const [hasFile, setHasFile] = useState(false);

  const loadSchema = useCallback(async () => {
    const res = await fetch("/api/images", { cache: "no-store" });
    const data: SchemaResponse = await res.json();
    setSchema(data);
  }, []);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/admin/status", { cache: "no-store" });
    const data: StatusResponse = await res.json();
    setAiStatus(data);
  }, []);

  useEffect(() => {
    loadSchema();
    loadStatus();
  }, [loadSchema, loadStatus]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  useEffect(() => {
    const dialog = adminDialogRef.current;
    if (!dialog) return;
    if (adminDialogOpen && !dialog.open) dialog.showModal();
    if (!adminDialogOpen && dialog.open) dialog.close();
  }, [adminDialogOpen]);

  useEffect(() => {
    const dialog = resolutionDialogRef.current;
    if (!dialog) return;
    if (resolutionDialogOpen && !dialog.open) dialog.showModal();
    if (!resolutionDialogOpen && dialog.open) dialog.close();
  }, [resolutionDialogOpen]);

  const albums = useMemo(() => {
    if (!schema) return [];
    return Object.values(schema.albums).sort((a, b) => a.title.localeCompare(b.title));
  }, [schema]);

  const imagesByAlbum = useMemo(() => {
    const map: Record<string, ImageRecord[]> = {};
    if (!schema) return map;
    for (const image of Object.values(schema.images)) {
      (map[image.label] ??= []).push(image);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    }
    return map;
  }, [schema]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage({ kind: "error", text: "Choose an image first." });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data: UploadResponse | KeyExpiredResponse | ProviderErrorResponse | ApiErrorResponse =
        await res.json();

      if (fileInputRef.current) fileInputRef.current.value = "";
      setHasFile(false);

      const pending = asPendingResolution(data);
      if (pending) {
        setPendingResolution(pending);
        setResolutionDialogOpen(true);
        return;
      }

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Upload failed." });
        return;
      }

      await Promise.all([loadSchema(), loadStatus()]);
      setActiveAlbum(data.label);
      setMessage({
        kind: "success",
        text: !data.classified
          ? "Upload succeeded! AI classification is disconnected, so it was filed under Unclassified."
          : data.createdNewAlbum
            ? "Upload succeeded! No existing album fit, so a new album was created for it."
            : "Upload succeeded! Filed into an existing album.",
      });
    } catch {
      setMessage({ kind: "error", text: "Upload failed: network error." });
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateAlbum(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim();
    const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value.trim();

    if (!title || !description) return;

    const res = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    const data: CreateAlbumResponse | ApiErrorResponse = await res.json();

    if (!res.ok || !("ok" in data)) {
      setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not create album." });
      return;
    }

    await loadSchema();
    setActiveAlbum(data.name);
    setDialogOpen(false);
    form.reset();
    setMessage({
      kind: "success",
      text:
        data.moved.length > 0
          ? `Album created. Re-filed ${data.moved.length} existing image(s) into it.`
          : "Album created.",
    });
  }

  async function handleDeleteAlbum(name: string) {
    const res = await fetch(`/api/albums?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    const data: { ok: true } | ApiErrorResponse = await res.json();

    if (!res.ok || !("ok" in data)) {
      setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not delete album." });
      return;
    }

    setActiveAlbum(HOME);
    await loadSchema();
  }

  async function handleConnect() {
    if (!adminPassword || !adminApiKey) {
      setMessage({ kind: "error", text: "Enter both the admin password and an API key." });
      return;
    }

    setAdminBusy(true);
    try {
      const res = await fetch("/api/admin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminSecret: adminPassword, apiKey: adminApiKey }),
      });
      const data: ConnectResponse | ApiErrorResponse = await res.json();

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not connect." });
        return;
      }

      setAdminPassword("");
      setAdminApiKey("");
      setAdminDialogOpen(false);

      // A file is still waiting on a decision from the resolution prompt - retry classifying
      // it with the freshly-connected key instead of showing the usual "sorted N images" message.
      if (pendingResolution) {
        await retryPendingUpload();
        return;
      }

      await Promise.all([loadStatus(), loadSchema()]);
      setMessage({
        kind: "success",
        text:
          data.remaining > 0
            ? `Connected. Sorted ${data.processed} unclassified image(s); ${data.remaining} left in the queue.`
            : data.processed > 0
              ? `Connected. Sorted all ${data.processed} unclassified image(s).`
              : "Connected.",
      });
    } catch {
      setMessage({ kind: "error", text: "Network error while connecting." });
    } finally {
      setAdminBusy(false);
    }
  }

  async function retryPendingUpload() {
    if (!pendingResolution) return;
    const { filename, url } = pendingResolution;

    const res = await fetch("/api/upload/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, url, action: "retry_classification" }),
    });
    const data: UploadResponse | KeyExpiredResponse | ProviderErrorResponse | ApiErrorResponse =
      await res.json();

    const pending = asPendingResolution(data);
    if (pending) {
      // The freshly-connected key didn't work either - loop back to the same prompt.
      setPendingResolution(pending);
      setResolutionDialogOpen(true);
      setMessage({ kind: "error", text: "That didn't work either: " + pending.message });
      await loadStatus();
      return;
    }

    setPendingResolution(null);
    await Promise.all([loadStatus(), loadSchema()]);

    if (!res.ok || !("ok" in data)) {
      setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not classify the pending image." });
      return;
    }

    setActiveAlbum(data.label);
    setMessage({
      kind: "success",
      text: `Connected! The pending image was classified into "${data.label}".`,
    });
  }

  async function handleFilePendingAsUnclassified() {
    if (!pendingResolution) return;
    const { filename, url } = pendingResolution;

    setResolutionBusy(true);
    try {
      const res = await fetch("/api/upload/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, url, action: "file_unclassified" }),
      });
      const data: UploadResponse | ApiErrorResponse = await res.json();

      setPendingResolution(null);
      setResolutionDialogOpen(false);

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not file the image." });
        return;
      }

      await Promise.all([loadSchema(), loadStatus()]);
      setActiveAlbum(data.label);
      setMessage({ kind: "success", text: "Filed under Unclassified for now." });
    } finally {
      setResolutionBusy(false);
    }
  }

  function handleConnectReplacementKey() {
    setResolutionDialogOpen(false);
    setAdminDialogOpen(true);
  }

  async function handleDiscardPendingUpload() {
    if (!pendingResolution) return;
    const { filename, url } = pendingResolution;

    setPendingResolution(null);
    setResolutionDialogOpen(false);

    await fetch("/api/upload/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, url, action: "discard" }),
    }).catch(() => undefined);

    setMessage({ kind: "success", text: "Upload cancelled." });
  }

  async function handleDisconnect() {
    if (!adminPassword) {
      setMessage({ kind: "error", text: "Enter the admin password first." });
      return;
    }

    setAdminBusy(true);
    try {
      const res = await fetch("/api/admin/connect", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminSecret: adminPassword }),
      });
      const data: { ok: true } | ApiErrorResponse = await res.json();

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not disconnect." });
        return;
      }

      setAdminPassword("");
      setAdminDialogOpen(false);
      await loadStatus();
      setMessage({ kind: "success", text: "Disconnected. New uploads will go to Unclassified." });
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRescan() {
    if (!adminPassword) {
      setMessage({ kind: "error", text: "Enter the admin password first." });
      return;
    }

    setAdminBusy(true);
    try {
      const res = await fetch("/api/admin/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminSecret: adminPassword }),
      });
      const data: SweepResponse | ApiErrorResponse = await res.json();

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Rescan failed." });
        return;
      }

      await Promise.all([loadStatus(), loadSchema()]);
      setMessage({
        kind: "success",
        text: `Rescanned ${data.processed} image(s); ${data.remaining} left in the queue.`,
      });
    } finally {
      setAdminBusy(false);
    }
  }

  const activeAlbumData: Album | undefined =
    activeAlbum !== HOME ? schema?.albums[activeAlbum] : undefined;
  const activeImages = imagesByAlbum[activeAlbum] ?? [];

  // The connected key might still look "enabled" per status (it exists) even though it was just
  // rejected - force the key-entry form instead of the Disconnect/Rescan view whenever there's a
  // pending upload waiting on a replacement key.
  const forceKeyEntry = !aiStatus?.enabled || pendingResolution !== null;

  return (
    <>
      <header>
        <select value={activeAlbum} onChange={(e) => setActiveAlbum(e.target.value)}>
          <option value={HOME}>Home</option>
          {albums.map((album) => (
            <option key={album.name} value={album.name}>
              {album.title} ({imagesByAlbum[album.name]?.length ?? 0})
            </option>
          ))}
        </select>

        <button type="button" onClick={() => setDialogOpen(true)}>
          + New album
        </button>

        <div className="separator" />

        <form onSubmit={handleUpload} style={{ display: "flex", gap: "1em", alignItems: "center" }}>
          <input
            ref={fileInputRef}
            type="file"
            name="image"
            accept="image/*"
            onChange={(e) => setHasFile(!!e.target.files?.length)}
          />
          <button type="submit" disabled={uploading || !hasFile}>
            {uploading ? "Classifying..." : "Upload"}
          </button>
        </form>

        <div className="separator" />

        <button
          type="button"
          className={`ai-badge ${aiStatus?.enabled ? "connected" : "disconnected"}`}
          onClick={() => setAdminDialogOpen(true)}
        >
          {aiStatus === null
            ? "AI status..."
            : aiStatus.enabled
              ? `● AI connected (${aiStatus.provider})`
              : "○ AI disconnected"}
        </button>

        {message && (
          <div className={`status-message ${message.kind}`} role="status">
            {message.text}
          </div>
        )}
      </header>

      <div id="browse-area">
        {activeAlbum === HOME && (
          <div className="empty-state">
            <h1>Welcome to your gallery!</h1>
            <p>
              Upload an image using the picker above. An AI agent looks at it, compares it against
              your existing albums, and either files it into the best match or invents a brand-new
              album on the spot if nothing fits well.
            </p>
            <p>
              You can also pre-create an album yourself with &ldquo;+ New album&rdquo; &mdash; the agent will
              immediately re-check any borderline images to see if they belong there instead.
            </p>
            <p>
              Classification needs an Anthropic or OpenAI key connected via the AI status button
              above. Until then, uploads are kept safe in an &ldquo;Unclassified&rdquo; album and get
              sorted automatically once a key is connected.
            </p>
          </div>
        )}

        {activeAlbum !== HOME && (
          <div>
            <div className="album-heading">
              <h2>
                {activeAlbumData?.title ?? activeAlbum}{" "}
                <small>{activeAlbumData?.description}</small>
              </h2>
              {activeImages.length === 0 && activeAlbum !== UNCLASSIFIED_ALBUM && (
                <button type="button" className="subtle" onClick={() => handleDeleteAlbum(activeAlbum)}>
                  Delete empty album
                </button>
              )}
            </div>

            {activeImages.length === 0 ? (
              <p className="empty-state">No images in this album yet.</p>
            ) : (
              <div className="gallery">
                {activeImages.map((image) => (
                  <figure className="image-cel" key={image.filename}>
                    <div className="thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote Blob URLs, not worth next/image config */}
                      <img src={image.url} alt={image.filename} loading="lazy" />
                    </div>
                    <figcaption>
                      <span>{image.filename}</span>
                      <span className="confidence">
                        {image.label === UNCLASSIFIED_ALBUM ? "pending" : `${Math.round(image.confidence * 100)}%`}
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <dialog ref={dialogRef} onClose={() => setDialogOpen(false)}>
        <form onSubmit={handleCreateAlbum}>
          <h2 style={{ marginBottom: "0.75em" }}>New album</h2>
          <div className="form-field">
            <label htmlFor="album-title">Title</label>
            <input id="album-title" name="title" type="text" placeholder="e.g. Birds" required />
          </div>
          <div className="form-field">
            <label htmlFor="album-description">Description</label>
            <textarea
              id="album-description"
              name="description"
              rows={3}
              placeholder="One sentence describing what belongs here - used by the AI to file future images."
              required
            />
          </div>
          <div className="dialog-actions">
            <button type="button" className="subtle" onClick={() => setDialogOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Create
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={adminDialogRef} onClose={() => setAdminDialogOpen(false)}>
        <h2 style={{ marginBottom: "0.75em" }}>AI classification</h2>

        <p className="empty-state" style={{ marginBottom: "1em" }}>
          {pendingResolution ? (
            <>
              The connected {pendingResolution.provider === "openai" ? "OpenAI" : "Anthropic"} key
              didn&apos;t work: &ldquo;{pendingResolution.message}&rdquo; Paste a working key below to
              classify the image you just uploaded.
            </>
          ) : forceKeyEntry ? (
            <>
              Not connected. Uploads are filed under &ldquo;Unclassified&rdquo; until a key is connected.
              There&apos;s no endpoint that hands back a key just by signing in &mdash; generate one yourself at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                console.anthropic.com
              </a>{" "}
              and paste it below.
            </>
          ) : (
            <>
              {aiStatus?.source === "env"
                ? `Connected via the ${aiStatus.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} environment variable.`
                : `Connected with a saved ${aiStatus?.provider} key.`}
              {aiStatus && aiStatus.unclassifiedCount > 0 &&
                ` ${aiStatus.unclassifiedCount} image(s) are still waiting in Unclassified.`}
            </>
          )}
        </p>

        <div className="form-field">
          <label htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="off"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </div>

        {forceKeyEntry && (
          <div className="form-field">
            <label htmlFor="admin-api-key">
              {(pendingResolution?.provider ?? aiStatus?.provider) === "openai" ? "OpenAI" : "Anthropic"} API key
            </label>
            <input
              id="admin-api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-..."
              value={adminApiKey}
              onChange={(e) => setAdminApiKey(e.target.value)}
            />
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            id="admin-close-button"
            className="subtle"
            onClick={() => setAdminDialogOpen(false)}
          >
            Close
          </button>
          {!forceKeyEntry && aiStatus?.source === "stored" && (
            <button
              type="button"
              id="admin-disconnect-button"
              className="subtle"
              onClick={handleDisconnect}
              disabled={adminBusy}
            >
              Disconnect
            </button>
          )}
          {!forceKeyEntry && aiStatus && aiStatus.unclassifiedCount > 0 && (
            <button type="button" id="admin-rescan-button" onClick={handleRescan} disabled={adminBusy}>
              Rescan Unclassified
            </button>
          )}
          {forceKeyEntry && (
            <button
              type="button"
              id="admin-connect-button"
              className="primary"
              onClick={handleConnect}
              disabled={adminBusy}
            >
              Connect
            </button>
          )}
        </div>
      </dialog>

      <dialog ref={resolutionDialogRef} onClose={() => setResolutionDialogOpen(false)}>
        <h2 style={{ marginBottom: "0.75em" }}>
          {pendingResolution?.kind === "provider_error"
            ? "Uh oh! The AI provider had a problem."
            : "Uh oh! The key has expired."}
        </h2>
        <p className="empty-state" style={{ marginBottom: "1em" }}>
          {pendingResolution?.kind === "provider_error" ? (
            <>
              The {pendingResolution.provider === "openai" ? "OpenAI" : "Anthropic"} API said:
              &ldquo;{pendingResolution.message}&rdquo; The image is safely uploaded; you just need to
              decide what to do with it.
            </>
          ) : (
            <>
              Your {pendingResolution?.provider === "openai" ? "OpenAI" : "Anthropic"} API key was
              rejected while classifying the image you just uploaded &mdash; it may have expired or
              been revoked. The image is safely uploaded; you just need to decide what to do with it.
            </>
          )}
        </p>
        <div className="dialog-actions" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            id="key-expired-discard-button"
            className="subtle"
            onClick={handleDiscardPendingUpload}
          >
            Go back
          </button>
          <button
            type="button"
            id="key-expired-unclassified-button"
            onClick={handleFilePendingAsUnclassified}
            disabled={resolutionBusy}
          >
            Upload as Unclassified
          </button>
          <button
            type="button"
            id="key-expired-reconnect-button"
            className="primary"
            onClick={handleConnectReplacementKey}
          >
            Connect a different key
          </button>
        </div>
      </dialog>
    </>
  );
}
