import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

export function FileDrop({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`file-drop${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Open a trajectory log file. Press Enter or Space to browse, or drop a .bin file here."
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={handleKey}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".bin"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <svg
        className="file-drop-icon"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p className="file-drop-primary">Drop a trajectory log here</p>
      <p className="file-drop-secondary">
        or <span className="linklike">browse for a .bin file</span>
        <br />
        Read locally, never uploaded.
      </p>
    </div>
  );
}
