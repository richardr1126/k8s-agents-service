"use client";

import { useAuiState } from "@assistant-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SparkleIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { useRecentChange } from "@/lib/use-recent-change";
import { activityOf, type Part } from "@/lib/working-activity";
import { useCatalog } from "@/components/command-view";

/** Filler while nothing more specific is known. The first one always leads. */
const WORDS = ["Thinking", "Pondering", "Cooking", "Brewing", "Tinkering", "Mulling", "Noodling", "Percolating"];
const WORD_MS = 2600;
/** Show the elapsed time once a wait gets this long. */
const ELAPSED_AFTER_S = 5;

/** Characters streamed so far, sub-agent output included; it grows only while something is being written. */
function writtenLength(content: readonly Part[]): number {
  let total = 0;
  for (const part of content) {
    if (part.type === "text" || part.type === "reasoning") total += part.text?.length ?? 0;
    for (const message of part.messages ?? []) total += writtenLength(message.content);
  }
  return total;
}

function useElapsedSeconds() {
  const [start] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [start]);
  return seconds;
}

function formatElapsed(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Shown under the newest assistant message for the whole run, whenever nothing
 * is being written: while the model thinks, a tool runs or a sub-agent works.
 * Stays mounted for the run so the timer counts from its start.
 */
export const WorkingIndicator: FC = () => {
  const written = useAuiState((s) => writtenLength(s.message.content as readonly Part[]));
  const catalog = useCatalog();
  const activity = useAuiState((s) => activityOf(s.message.content as readonly Part[], catalog));
  const waiting = useAuiState((s) => s.message.status?.type === "requires-action");
  const writing = useRecentChange(written, true);
  const elapsed = useElapsedSeconds();
  const reduceMotion = useReducedMotion();

  const [word, setWord] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setWord((w) => (w + 1) % WORDS.length), WORD_MS);
    return () => clearInterval(timer);
  }, []);

  const label = activity ?? WORDS[word];
  const show = !writing && !waiting;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="working"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <SparkleIcon className="size-3.5 shrink-0 text-primary/80 motion-safe:animate-[working-pulse_1.6s_ease-in-out_infinite]" />
            <span className="relative inline-grid">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={label}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                  transition={{ duration: reduceMotion ? 0 : 0.25 }}
                  className="working-shimmer whitespace-nowrap"
                >
                  {label}…
                </motion.span>
              </AnimatePresence>
            </span>
            {elapsed >= ELAPSED_AFTER_S && <span className="tabular-nums text-xs text-muted-foreground/70">{formatElapsed(elapsed)}</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
