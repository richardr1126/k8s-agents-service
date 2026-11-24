"use client";

import { useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { speechQuery } from "@/lib/queries";
import { speakable, speechPieces } from "@/lib/speakable";

/** A moment of silence as a WAV data URL, played during the click to unlock audio. */
function silence(): string {
  const samples = 800; // 0.1 s of 8-bit mono at 8 kHz
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

type ReaderState = { messageId: string | null; status: "idle" | "loading" | "playing" };

/**
 * One reader for the whole page, so starting a reply stops the one before and
 * playback carries on while the action bar is hidden. Each piece of the reply is
 * fetched while the one before plays.
 */
class Reader {
  state: ReaderState = { messageId: null, status: "idle" };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  /**
   * The one element every piece plays in. Safari only lets audio play from a tap,
   * and the first piece arrives seconds after it, so the element is started during
   * the click (on silence) and reused; once started that way it may play again.
   */
  private element: HTMLAudioElement | null = null;

  /** Call synchronously in the click: unlocks the shared element for later playback. */
  private unlock(): HTMLAudioElement {
    this.element ??= new Audio();
    const element = this.element;
    element.src = silence();
    element.play().catch(() => {});
    return element;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: ReaderState) {
    this.state = state;
    for (const l of this.listeners) l();
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.audio?.pause();
    this.audio = null;
    if (this.state.status !== "idle") this.set({ messageId: null, status: "idle" });
  }

  async read(messageId: string, markdown: string) {
    this.stop();
    const pieces = speechPieces(speakable(markdown));
    if (pieces.length === 0) return;
    const element = this.unlock();
    const abort = new AbortController();
    this.abort = abort;
    this.set({ messageId, status: "loading" });
    const fetchPiece = async (text: string) => {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Couldn't read this aloud (HTTP ${res.status}).`);
      }
      return URL.createObjectURL(await res.blob());
    };
    try {
      let next = fetchPiece(pieces[0]);
      for (let i = 0; i < pieces.length; i++) {
        const url = await next;
        if (i + 1 < pieces.length) next = fetchPiece(pieces[i + 1]);
        next?.catch(() => {}); // surfaced when awaited
        try {
          await this.playUrl(element, url, abort.signal);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) toast.error(e instanceof Error ? e.message : "Couldn't read this aloud.");
    } finally {
      if (this.abort === abort) {
        this.abort = null;
        this.audio = null;
        this.set({ messageId: null, status: "idle" });
      }
    }
  }

  private playUrl(audio: HTMLAudioElement, url: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve();
      audio.pause();
      audio.src = url;
      this.audio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("The audio couldn't be played."));
      signal.addEventListener("abort", () => resolve(), { once: true });
      audio
        .play()
        .then(() => this.state.status !== "playing" && this.set({ ...this.state, status: "playing" }))
        .catch(reject);
    });
  }
}

const reader = new Reader();
const getState = () => reader.state;

/** Reads the reply aloud with Host 1's voice from Settings → Speech; shown once OpenReader is connected. */
export const ReadAloudAction = () => {
  const { data } = useQuery(speechQuery);
  const messageId = useAuiState((s) => s.message.id);
  const text = useAuiState((s) =>
    s.message.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n"),
  );
  const state = useSyncExternalStore(reader.subscribe, getState, getState);
  if (!data?.available) return null;

  const active = state.messageId === messageId;
  return (
    <TooltipIconButton
      tooltip={active ? "Stop reading" : "Read aloud"}
      onClick={() => (active ? reader.stop() : void reader.read(messageId, text))}
    >
      {active && state.status === "loading" ? (
        <LoaderIcon className="animate-spin" />
      ) : active ? (
        <SquareIcon className="fill-current" />
      ) : (
        <Volume2Icon />
      )}
    </TooltipIconButton>
  );
};
