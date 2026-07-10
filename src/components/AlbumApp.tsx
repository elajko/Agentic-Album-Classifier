"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  CreateAlbumResponse,
  SchemaResponse,
  StatusResponse,
  SweepResponse,
  UploadResponse,
} from "@/lib/api-types";
import type { Album, ImageRecord } from "@/lib/types";
import { UNCLASSIFIED_ALBUM } from "@/lib/types";

type StatusMessage = { kind: "success" | "error"; text: string };

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
      const data: UploadResponse | ApiErrorResponse = await res.json();

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

      if (fileInputRef.current) fileInputRef.current.value = "";
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
      const data: SweepResponse | ApiErrorResponse = await res.json();

      if (!res.ok || !("ok" in data)) {
        setMessage({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not connect." });
        return;
      }

      setAdminPassword("");
      setAdminApiKey("");
      setAdminDialogOpen(false);
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
          <input ref={fileInputRef} type="file" name="image" accept="image/*" />
          <button type="submit" disabled={uploading}>
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
          {aiStatus?.enabled ? (
            <>
              {aiStatus.source === "env"
                ? `Connected via the ${aiStatus.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} environment variable.`
                : `Connected with a saved ${aiStatus.provider} key.`}
              {aiStatus.unclassifiedCount > 0 &&
                ` ${aiStatus.unclassifiedCount} image(s) are still waiting in Unclassified.`}
            </>
          ) : (
            <>
              Not connected. Uploads are filed under &ldquo;Unclassified&rdquo; until a key is connected.
              There&apos;s no endpoint that hands back a key just by signing in &mdash; generate one yourself at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                console.anthropic.com
              </a>{" "}
              and paste it below.
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

        {!aiStatus?.enabled && (
          <div className="form-field">
            <label htmlFor="admin-api-key">
              {aiStatus?.provider === "openai" ? "OpenAI" : "Anthropic"} API key
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
          {aiStatus?.enabled && aiStatus.source === "stored" && (
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
          {aiStatus?.enabled && aiStatus.unclassifiedCount > 0 && (
            <button type="button" id="admin-rescan-button" onClick={handleRescan} disabled={adminBusy}>
              Rescan Unclassified
            </button>
          )}
          {!aiStatus?.enabled && (
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
    </>
  );
}
