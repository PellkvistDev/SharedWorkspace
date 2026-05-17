import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { FileEntry, ListDirResponse, ReadFileResponse } from "@workspaceos/shared";
import Editor from "@monaco-editor/react";

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function fileLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
    sh: "shell", bash: "shell", ps1: "powershell", bat: "bat",
    sql: "sql", yml: "yaml", yaml: "yaml", xml: "xml", svg: "xml",
  };
  return map[ext] || "plaintext";
}

export default function FileExplorer() {
  const [data, setData] = useState<ListDirResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [preview, setPreview] = useState<ReadFileResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (path: string) => {
    setError(null);
    try {
      const res = await api.get<ListDirResponse>(`/api/files/list?path=${encodeURIComponent(path)}`);
      setData(res);
    } catch (e: any) {
      setError(e.message || "Failed to list");
    }
  }, []);

  useEffect(() => { load(""); }, [load]);

  // Auto-refresh when window regains focus (catches files created on the PC
  // while you were elsewhere).
  useEffect(() => {
    const refresh = () => load(data?.cwd || "");
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, data?.cwd]);

  const moveTo = async (sourceRelPath: string, destDirRelPath: string) => {
    const name = sourceRelPath.includes("/")
      ? sourceRelPath.slice(sourceRelPath.lastIndexOf("/") + 1)
      : sourceRelPath;
    const to = destDirRelPath ? `${destDirRelPath}/${name}` : name;
    if (to === sourceRelPath) return;
    try {
      await api.post("/api/files/rename", { from: sourceRelPath, to });
      load(data?.cwd || "");
    } catch (e: any) {
      alert("Move failed: " + e.message);
    }
  };

  useEffect(() => {
    if (!selected || selected.kind !== "file") {
      setPreview(null);
      setEditing(false);
      return;
    }
    (async () => {
      try {
        const r = await api.get<ReadFileResponse>(`/api/files/read?path=${encodeURIComponent(selected.path)}`);
        setPreview(r);
        setEditValue(r.encoding === "utf8" ? r.content : "");
        setEditing(false);
      } catch (e: any) {
        setPreview(null);
        setError(e.message);
      }
    })();
  }, [selected]);

  const openEntry = (e: FileEntry) => {
    if (e.kind === "directory") {
      setSelected(null);
      load(e.path);
    } else {
      setSelected(e);
    }
  };

  const newFolder = async () => {
    const name = prompt("New folder name:");
    if (!name) return;
    const target = data?.cwd ? `${data.cwd}/${name}` : name;
    try {
      await api.post("/api/files/mkdir", { path: target });
      load(data?.cwd || "");
    } catch (e: any) { alert(e.message); }
  };

  const renameSelected = async () => {
    if (!selected) return;
    const newName = prompt("New name:", selected.name);
    if (!newName || newName === selected.name) return;
    const parent = selected.path.includes("/") ? selected.path.slice(0, selected.path.lastIndexOf("/")) : "";
    const to = parent ? `${parent}/${newName}` : newName;
    try {
      await api.post("/api/files/rename", { from: selected.path, to });
      setSelected(null);
      load(data?.cwd || "");
    } catch (e: any) { alert(e.message); }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!confirm(`Delete ${selected.name}?`)) return;
    try {
      await api.del("/api/files/delete", { path: selected.path });
      setSelected(null);
      load(data?.cwd || "");
    } catch (e: any) { alert(e.message); }
  };

  const saveEdit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await api.post("/api/files/write", { path: preview.path, content: editValue, encoding: "utf8" });
      setEditing(false);
      const r = await api.get<ReadFileResponse>(`/api/files/read?path=${encodeURIComponent(preview.path)}`);
      setPreview(r);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: File[], destPath?: string) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name);
    try {
      const csrfRes = await api.get<{ csrf?: string }>("/api/auth/status");
      const res = await fetch(
        `/api/files/upload?path=${encodeURIComponent(destPath ?? data?.cwd ?? "")}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": csrfRes.csrf || "" },
          body: fd,
        }
      );
      if (!res.ok) throw new Error(await res.text());
      load(data?.cwd || "");
    } catch (e: any) {
      alert("Upload failed: " + e.message);
    }
  };

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer.files.length) {
      uploadFiles(Array.from(ev.dataTransfer.files));
      return;
    }
    // Internal move into current folder
    const src = ev.dataTransfer.getData("application/x-wos-path");
    if (src) moveTo(src, data?.cwd || "");
  };

  return (
    <div className="h-full grid md:grid-cols-[280px_1fr] grid-cols-1 grid-rows-[auto_1fr] md:grid-rows-1">
      {/* Sidebar */}
      <aside
        ref={dropRef}
        className="border-r border-white/10 flex flex-col min-h-0"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={onDrop}
      >
        <div className="p-2 border-b border-white/10 space-y-2">
          <div className="flex items-center gap-1 text-xs">
            <button
              className="btn btn-ghost text-xs px-2"
              disabled={!data?.parent && data?.cwd === ""}
              onClick={() => load(data?.parent ?? "")}
              onDragOver={(ev) => {
                if (data?.parent != null) {
                  ev.preventDefault();
                  ev.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(ev) => {
                const src = ev.dataTransfer.getData("application/x-wos-path");
                if (src && data?.parent != null) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  moveTo(src, data.parent);
                }
              }}
              title="Up (drop to move into parent)"
            >
              ↑
            </button>
            <button
              className="btn btn-ghost text-xs px-2"
              onClick={() => load(data?.cwd || "")}
              title="Refresh"
            >
              ↻
            </button>
            <div className="font-mono truncate text-white/80 flex-1">
              /{data?.cwd || ""}
            </div>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-ghost text-xs flex-1" onClick={newFolder}>+ Folder</button>
            <label className="btn btn-ghost text-xs flex-1 cursor-pointer">
              + Upload
              <input
                type="file"
                className="hidden"
                multiple
                onChange={async (e) => {
                  if (!e.target.files?.length) return;
                  const fd = new FormData();
                  for (const f of Array.from(e.target.files)) fd.append("file", f, f.name);
                  try {
                    const csrfRes = await api.get<{ csrf?: string }>("/api/auth/status");
                    const res = await fetch(`/api/files/upload?path=${encodeURIComponent(data?.cwd || "")}`, {
                      method: "POST", credentials: "include",
                      headers: { "x-csrf-token": csrfRes.csrf || "" },
                      body: fd,
                    });
                    if (!res.ok) throw new Error(await res.text());
                    load(data?.cwd || "");
                  } catch (err: any) { alert("Upload failed: " + err.message); }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {error && <div className="p-3 text-xs text-red-400">{error}</div>}
          {data?.entries.map((e) => (
            <div
              key={e.path}
              onClick={() => { setSelected(e); }}
              onDoubleClick={() => openEntry(e)}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData("application/x-wos-path", e.path);
                ev.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(ev) => {
                if (e.kind === "directory") {
                  ev.preventDefault();
                  ev.dataTransfer.dropEffect = "move";
                  ev.currentTarget.classList.add("ring-1", "ring-sky-400/60");
                }
              }}
              onDragLeave={(ev) => {
                ev.currentTarget.classList.remove("ring-1", "ring-sky-400/60");
              }}
              onDrop={(ev) => {
                ev.currentTarget.classList.remove("ring-1", "ring-sky-400/60");
                if (e.kind !== "directory") return;
                // OS-file drop?
                if (ev.dataTransfer.files.length) {
                  // Forward to the sidebar drop handler with this folder as target.
                  ev.preventDefault();
                  ev.stopPropagation();
                  uploadFiles(Array.from(ev.dataTransfer.files), e.path);
                  return;
                }
                const src = ev.dataTransfer.getData("application/x-wos-path");
                if (!src || src === e.path) return;
                ev.preventDefault();
                ev.stopPropagation();
                moveTo(src, e.path);
              }}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-white/10 rounded transition",
                selected?.path === e.path && "bg-white/15"
              )}
            >
              <span className="w-4 text-center text-white/55">
                {e.kind === "directory" ? "▸" : "·"}
              </span>
              <span className="flex-1 truncate">{e.name}</span>
              <span className="text-[10px] text-white/40 tabular-nums">
                {e.kind === "directory" ? "" : fmtSize(e.size)}
              </span>
            </div>
          ))}
          {data?.entries.length === 0 && <div className="p-3 text-xs text-white/40">Empty folder. Drop files here.</div>}
        </div>
        <div className="p-2 text-[10px] text-white/40 border-t border-white/10">
          Drag files anywhere on this sidebar to upload.
        </div>
      </aside>

      {/* Preview / editor pane */}
      <section className="flex flex-col min-h-0">
        {!selected && (
          <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
            {data ? "Select a file to preview." : "Loading…"}
          </div>
        )}
        {selected && selected.kind === "directory" && (
          <div className="flex-1 flex items-center justify-center text-sm text-white/55">
            <button className="btn" onClick={() => openEntry(selected)}>Open {selected.name}</button>
          </div>
        )}
        {selected && selected.kind === "file" && (
          <>
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
              <div className="font-mono truncate text-white/80">{selected.path}</div>
              <div className="flex gap-1">
                <a
                  className="btn btn-ghost text-xs"
                  href={`/api/files/raw?path=${encodeURIComponent(selected.path)}&download=1`}
                  download
                >
                  Download
                </a>
                {preview?.encoding === "utf8" && !editing && (
                  <button className="btn btn-ghost text-xs" onClick={() => setEditing(true)}>Edit</button>
                )}
                {editing && (
                  <button className="btn btn-primary text-xs" disabled={busy} onClick={saveEdit}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                )}
                <button className="btn btn-ghost text-xs" onClick={renameSelected}>Rename</button>
                <button className="btn btn-ghost text-xs text-red-400" onClick={deleteSelected}>Delete</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {preview && preview.encoding === "utf8" && !editing && (
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words">{preview.content}</pre>
              )}
              {preview && preview.encoding === "utf8" && editing && (
                <Editor
                  height="100%"
                  defaultLanguage={fileLang(preview.path)}
                  value={editValue}
                  onChange={(v) => setEditValue(v ?? "")}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: "on",
                  }}
                />
              )}
              {preview && preview.encoding === "base64" && preview.mime.startsWith("image/") && (
                <div className="p-4 flex items-center justify-center">
                  <img
                    src={`data:${preview.mime};base64,${preview.content}`}
                    alt={preview.path}
                    className="max-w-full max-h-[80vh]"
                  />
                </div>
              )}
              {preview && preview.encoding === "base64" && preview.mime === "application/pdf" && (
                <iframe
                  className="w-full h-full"
                  src={`/api/files/raw?path=${encodeURIComponent(preview.path)}`}
                />
              )}
              {preview && preview.encoding === "base64" &&
                !preview.mime.startsWith("image/") && preview.mime !== "application/pdf" && (
                  <div className="p-4 text-sm text-white/55">
                    Binary file ({fmtSize(preview.size)}, {preview.mime}). Download to view.
                  </div>
                )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
