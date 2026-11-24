import {
  HttpAgent,
  runHttpRequest,
  transformHttpEventStream,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable, type Subscription } from "rxjs";

/** Reconnect attempts in a row, with no event between them, before the stream counts as lost. */
const RETRIES = 6;

const ENDED = new Set(["RUN_FINISHED", "RUN_ERROR"]);

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

type Options = HttpAgentConfig & {
  /** The run was there but can't be followed any more (it ended long ago, or the server restarted). */
  onLost?: (threadId: string) => void;
};

/**
 * An agent whose replies survive a dropped stream. The backend runs a reply apart
 * from the request that started it and keeps its events, so when the stream breaks
 * this picks it up again from the last event it had, and a reloaded page joins a
 * reply still running (`connect`). Only the stop button stops a reply.
 */
export class LiveAgent extends HttpAgent {
  onLost?: (threadId: string) => void;

  constructor({ onLost, ...config }: Options) {
    super(config);
    this.onLost = onLost;
  }

  /** What to do when a reply can't be followed any more. */
  whenLost(handler: (threadId: string) => void) {
    this.onLost = handler;
  }

  clone(): LiveAgent {
    const copy = super.clone() as LiveAgent;
    copy.onLost = this.onLost;
    return copy;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return this.follow(input.threadId, super.run(input));
  }

  /** Joins the thread's running reply from its first event. */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    // The last run's controller may be the aborted one.
    this.abortController = new AbortController();
    return this.follow(input.threadId);
  }

  abortRun(): void {
    const threadId = this.threadId;
    super.abortRun();
    void fetch(`/api/threads/${encodeURIComponent(threadId)}/run`, { method: "DELETE" }).catch(() => {});
  }

  /** `first`'s events, then the rest of the reply from the backend whenever the stream drops. */
  private follow(threadId: string, first?: Observable<BaseEvent>): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const signal = this.abortController.signal;
      let seen = 0;
      let failures = 0;
      let closed = false;
      let inner: Subscription | undefined;

      const listen = (source: Observable<BaseEvent>) => {
        let ended = false;
        inner = source.subscribe({
          next: (event) => {
            seen += 1;
            failures = 0;
            if (ENDED.has(event.type)) ended = true;
            subscriber.next(event);
          },
          // A reply that started can be followed again; a request that never started one can't.
          error: (error) => (seen > 0 || !first ? void rejoin(error) : subscriber.error(error)),
          complete: () => (ended ? subscriber.complete() : void rejoin(new Error("The stream ended early."))),
        });
      };

      const rejoin = async (error: unknown) => {
        while (!closed && !signal.aborted) {
          if (failures > 0) await pause(Math.min(500 * 2 ** failures, 8000), signal);
          if (closed || signal.aborted) return;
          if (failures++ >= RETRIES) return subscriber.error(error);
          let res: Response;
          try {
            res = await this.fetch(`/api/threads/${encodeURIComponent(threadId)}/run/stream?since=${seen}`, {
              headers: { Accept: "text/event-stream" },
              signal,
            });
          } catch {
            continue; // still offline
          }
          if (res.status === 404) {
            // Nothing left to follow: the stored conversation has the reply.
            this.onLost?.(threadId);
            return subscriber.complete();
          }
          if (!res.ok) continue;
          return listen(transformHttpEventStream(runHttpRequest(() => Promise.resolve(res))));
        }
      };

      if (first) listen(first);
      else void rejoin(new Error("Couldn't join the reply."));
      return () => {
        closed = true;
        inner?.unsubscribe();
      };
    });
  }
}
