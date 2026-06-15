"use client";

import { ImagePlus, Mic, Plus, SendHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";

type Props = {
  onSend: (body: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
};

export function MessageComposer({ onSend, onTyping }: Props) {
  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTypingRef = useRef(false);

  async function compressImage(file: File): Promise<Blob | File> {
    if (!file.type.startsWith("image/") || file.size < 150 * 1024) {
      return file;
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name, { type: "image/jpeg", lastModified: Date.now() }));
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.75
        );
      };
      img.onerror = () => {
        resolve(file);
      };
    });
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const processed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", processed);
      
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const { url } = await res.json();
        setBody((prev) => prev + (prev ? "\n\n" : "") + `![Image](${url})`);
      }
    } catch (error) {
      console.error("Compression/Upload failed", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    let value = body.trim();
    if (!value) return;

    if (value === "/shrug") {
      value = "¯\\_(ツ)_/¯";
    } else if (value.startsWith("/me ")) {
      value = `_${value.slice(4)}_`;
    }

    setBody("");
    isTypingRef.current = false;
    onTyping(false);
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    await onSend(value);
  }

  return (
    <form
      className="glass-overlay sticky bottom-0 z-20 mx-3 mb-[78px] flex items-end gap-2 rounded-2xl p-2 lg:mb-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <IconButton label="Add attachment">
        <Plus size={18} />
      </IconButton>
      <div className="min-h-11 flex-1 rounded-2xl bg-surface px-3 py-2 dark:bg-surface-dark">
        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (!isTypingRef.current) {
              isTypingRef.current = true;
              onTyping(true);
            }
            if (typingTimer.current) window.clearTimeout(typingTimer.current);
            typingTimer.current = window.setTimeout(() => {
              isTypingRef.current = false;
              onTyping(false);
            }, 1400);
          }}
          rows={1}
          placeholder="Message Sanctuary"
          className="max-h-32 min-h-7 w-full resize-none bg-transparent text-sm leading-7 outline-none"
        />
      </div>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
      <IconButton label="Add image" className="hidden sm:grid" onClick={() => fileInputRef.current?.click()}>
        <ImagePlus size={18} className={uploading ? "animate-pulse" : ""} />
      </IconButton>
      <IconButton label="Voice note" className="hidden sm:grid">
        <Mic size={18} />
      </IconButton>
      <button
        aria-label="Send message"
        className="grid size-11 place-items-center rounded-full bg-blue-strong text-white transition active:scale-95 disabled:opacity-45"
        disabled={!body.trim()}
      >
        <SendHorizontal size={18} />
      </button>
    </form>
  );
}
