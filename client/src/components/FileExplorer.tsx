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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, FileEntry[]>>(new Map());
  const dropRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (path: string) => {
    setError(null);
    try {
      const res = await api.get<ListDirResponse>(`/api/files/list?path=${encodeURIComponent(path)}`);
      setData(res);
      // Invalidate any cached subtree for the new cwd
      setChildren((m) => {
        const next = new Map(m);
        next.delete(res.cwd);
        return next;
      });
    } catch (e: any) {
      setError(e.message || "Failed to list");
    }
  }, []);

  const loadChildren = useCallback(async (path: string) => {
    try {
      const res = await api.get<ListDirResponse>(`/api/files/list?path=${encodeURIComponent(path)}`);
      setChildren((m) => {
        const next = new Map(m);
        next.set(path, res.entries);
        return next;
      });
    } catch (e: any) {
      setError(e.message || "Failed to expand");
    }
  }, []);

  const toggleExpanded = useCallback(async (entry: FileEntry) => {
    if (entry.kind !== "directory") return;
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
        // fire-and-forget load if uncached
        if (!children.has(entry.path)) loadChildren(entry.path);
      }
      return next;
    });
  }, [children, loadChildren]);

  useEffect(() => { load(""); }, [load]);

  // Auto-refresh when window regains focus (catches files created on the PC
  // while you were elsewhere).
  useEffect(() => {
    const refresh = () => {
      load(data?.cwd || "");
      // Re-fetch every currently expanded subtree
      for (const p of expanded) loadChildren(p);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, loadChildren, data?.cwd, expanded]);

  const refreshAfterMutation = useCallback((touchedPath: string) => {
    load(data?.cwd || "");
    // Re-fetch the containing folder if it's expanded
    const parent = touchedPath.includes("/") ? touchedPath.slice(0, touchedPath.lastIndexOf("/")) : "";
    if (parent && expanded.has(parent)) loadChildren(parent);
    // Re-fetch every expanded subtree (cheap, keeps tree consistent after moves)
    for (const p of expanded) if (p !== parent) loadChildren(p);
  }, [load, loadChildren, data?.cwd, expanded]);

  const moveTo = async (sourceRelPath: string, destDirRelPath: string) => {
    const name = sourceRelPath.includes("/")
      ? sourceRelPath.slice(sourceRelPath.lastIndexOf("/") + 1)
      : sourceRelPath;
    const to = destDirRelPath ? `${destDirRelPath}/${name}` : name;
    if (to === sourceRelPath) return;
    // Disallow moving a folder into itself or its descendants
    if (destDirRelPath === sourceRelPath || destDirRelPath.startsWith(sourceRelPath + "/")) {
      alert("Can't move a folder into itself.");
      return;
    }
    try {
      await api.post("/api/files/rename", { from: sourceRelPath, to });
      refreshAfterMutation(sourceRelPath);
      refreshAfterMutation(to);
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

  const deleteEntry = async (entry: FileEntry) => {
    const label = entry.kind === "directory" ? `folder "${entry.name}" and everything in it` : `"${entry.name}"`;
    if (!confirm(`Delete ${label}?`)) return;
    try {
      await api.del("/api/files/delete", { path: entry.path });
      if (selected?.path === entry.path) setSelected(null);
      refreshAfterMutation(entry.path);
    } catch (e: any) { alert(e.message); }
  };

  const renameEntry = async (entry: FileEntry) => {
    const newName = prompt("New name:", entry.name);
    if (!newName || newName === entry.name) return;
    const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
    const to = parent ? `${parent}/${newName}` : newName;
    try {
      await api.post("/api/files/rename", { from: entry.path, to });
      if (selected?.path === entry.path) setSelected(null);
      refreshAfterMutation(entry.path);
    } catch (e: any) { alert(e.message); }
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

  const renameSelected = () => selected && renameEntry(selected);
  const deleteSelected = () => selected && deleteEntry(selected);

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
        <div className="flex-1 min-h-0 overflow-auto py-1">
          {error && <div className="p-3 text-xs text-red-400">{error}</div>}
          {data?.entries.map((e) => (
            <TreeRow
              key={e.path}
              entry={e}
              depth={0}
              expanded={expanded}
              children_={children}
              selected={selected}
              onSelect={setSelected}
              onOpen={openEntry}
              onToggle={toggleExpanded}
              onMove={moveTo}
              onUpload={uploadFiles}
              onRename={renameEntry}
              onDelete={deleteEntry}
            />
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

interface TreeRowProps {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  children_: Map<string, FileEntry[]>;
  selected: FileEntry | null;
  onSelect: (e: FileEntry) => void;
  onOpen: (e: FileEntry) => void;
  onToggle: (e: FileEntry) => void;
  onMove: (from: string, to: string) => void;
  onUpload: (files: File[], destPath?: string) => void;
  onRename: (e: FileEntry) => void;
  onDelete: (e: FileEntry) => void;
}

function TreeRow({
  entry, depth, expanded, children_, selected,
  onSelect, onOpen, onToggle, onMove, onUpload, onRename, onDelete,
}: TreeRowProps) {
  const isDir = entry.kind === "directory";
  const isOpen = isDir && expanded.has(entry.path);
  const kids = isOpen ? children_.get(entry.path) : undefined;
  return (
    <>
      <div
        onClick={() => onSelect(entry)}
        onDoubleClick={() => onOpen(entry)}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData("application/x-wos-path", entry.path);
          ev.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(ev) => {
          if (isDir) {
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
          if (!isDir) return;
          if (ev.dataTransfer.files.length) {
            ev.preventDefault();
            ev.stopPropagation();
            onUpload(Array.from(ev.dataTransfer.files), entry.path);
            return;
          }
          const src = ev.dataTransfer.getData("application/x-wos-path");
          if (!src || src === entry.path) return;
          ev.preventDefault();
          ev.stopPropagation();
          onMove(src, entry.path);
        }}
        className={clsx(
          "group flex items-center gap-1 pr-2 py-1 text-sm cursor-pointer hover:bg-white/10 rounded transition",
          selected?.path === entry.path && "bg-white/15"
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {isDir ? (
          <button
            className="w-4 text-center text-white/55 hover:text-white"
            onClick={(e) => { e.stopPropagation(); onToggle(entry); }}
            title={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 text-center text-white/30">·</span>
        )}
        <span className="flex-1 truncate">{entry.name}</span>
        <span className="text-[10px] text-white/40 tabular-nums opacity-100 group-hover:opacity-0 transition">
          {isDir ? "" : fmtSize(entry.size)}
        </span>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button
            className="text-xs px-1.5 py-0.5 rounded hover:bg-white/15 text-white/70"
            onClick={(e) => { e.stopPropagation(); onRename(entry); }}
            title="Rename"
          >
            ✎
          </button>
          <button
            className="text-xs px-1.5 py-0.5 rounded hover:bg-red-500/30 text-red-300"
            onClick={(e) => { e.stopPropagation(); onDelete(entry); }}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
      {isOpen && (
        <>
          {kids === undefined && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 }} className="text-[10px] text-white/40 py-0.5">
              Loading…
            </div>
          )}
          {kids?.map((c) => (
            <TreeRow
              key={c.path}
              entry={c}
              depth={depth + 1}
              expanded={expanded}
              children_={children_}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              onToggle={onToggle}
              onMove={onMove}
              onUpload={onUpload}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
          {kids && kids.length === 0 && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 }} className="text-[10px] text-white/40 py-0.5">
              empty
            </div>
          )}
        </>
      )}
    </>
  );
}
