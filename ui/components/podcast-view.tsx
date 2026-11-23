"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Fold } from "@/components/ui/fold";
import { cn } from "@/lib/utils";

export type Podcast = {
  title: string;
  audio: string;
  seconds: number;
  script: { host: 1 | 2; text: string }[];
};

export function isPodcast(value: unknown): value is Podcast {
  const v = value as Partial<Podcast> | null;
  return !!v && typeof v.audio === "string" && v.audio.startsWith("/api/jobs/") && Array.isArray(v.script);
}

/** A finished paper podcast: the episode player, a download link and the transcript. */
export function PodcastView({ podcast }: { podcast: Podcast }) {
  const [transcript, setTranscript] = useState(false);
  return (
    <div className="space-y-2">
      <audio controls preload="metadata" src={podcast.audio} className="h-10 w-full" aria-label={podcast.title} />
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setTranscript((t) => !t)}
          aria-expanded={transcript}
          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          {transcript ? "Hide transcript" : "Show transcript"}
        </button>
        <a
          href={`${podcast.audio}?download`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <DownloadIcon className="size-3" />
          Download MP3
        </a>
      </div>
      <Fold open={transcript}>
        <ol className="max-h-80 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-3 text-[13px] leading-6">
          {podcast.script.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className={cn("w-14 shrink-0 font-medium", line.host === 1 ? "text-brand" : "text-muted-foreground")}>
                Host {line.host}
              </span>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      </Fold>
    </div>
  );
}
