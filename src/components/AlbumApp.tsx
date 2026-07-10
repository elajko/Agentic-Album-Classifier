"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  CreateAlbumResponse,
  SchemaResponse,
  UploadResponse,
} from "@/lib/api-types";
import type { Album, ImageRecord } from "@/lib/types";

type StatusMessage = { kind: "success" | "error"; text: string };

const HOME = "home";

export default function AlbumApp() {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<string>(HOME);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSchema = useCallback(async () => {
    const res = await fetch("/api/images", { cache: "no-store" });
    const data: SchemaResponse = await res.json();
    setSchema(data);
  }, []);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

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
      setStatus({ kind: "error", text: "Choose an image first." });
      return;
    }

    setUploading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data: UploadResponse | ApiErrorResponse = await res.json();

      if (!res.ok || !("ok" in data)) {
        setStatus({ kind: "error", text: (data as ApiErrorResponse).error ?? "Upload failed." });
        return;
      }

      await loadSchema();
      setActiveAlbum(data.label);
      setStatus({
        kind: "success",
        text: data.createdNewAlbum
          ? `Upload succeeded! No existing album fit, so a new album was created for it.`
          : `Upload succeeded! Filed into an existing album.`,
      });

      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setStatus({ kind: "error", text: "Upload failed: network error." });
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
      setStatus({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not create album." });
      return;
    }

    await loadSchema();
    setActiveAlbum(data.name);
    setDialogOpen(false);
    form.reset();
    setStatus({
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
      setStatus({ kind: "error", text: (data as ApiErrorResponse).error ?? "Could not delete album." });
      return;
    }

    setActiveAlbum(HOME);
    await loadSchema();
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

        {status && (
          <div className={`status-message ${status.kind}`} role="status">
            {status.text}
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
          </div>
        )}

        {activeAlbum !== HOME && (
          <div>
            <div className="album-heading">
              <h2>
                {activeAlbumData?.title ?? activeAlbum}{" "}
                <small>{activeAlbumData?.description}</small>
              </h2>
              {activeImages.length === 0 && (
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
                      <span className="confidence">{Math.round(image.confidence * 100)}%</span>
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
    </>
  );
}
