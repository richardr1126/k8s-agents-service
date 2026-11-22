"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, Badge, Row, Section } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Status = { configured: boolean; origin: string | null; connected: boolean; hostVoices: string[]; canConnect: boolean };
type Voices = { voices: { id: string; name: string }[]; provider: string | null; model: string | null };

const SAVED = "__saved__";

/** Connects the user's OpenReader account, which speaks replies and podcasts. */
export function SpeechConnection({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Status>("/api/openreader").then(setStatus, (e: Error) => setError(e.message)), []);

  useEffect(() => {
    void load();
    // The OAuth callback comes back here with ?openreader=connected or an error message.
    const url = new URL(window.location.href);
    const result = url.searchParams.get("openreader");
    if (result) {
      if (result === "connected") toast.success("OpenReader connected");
      else toast.error(result);
      url.searchParams.delete("openreader");
      history.replaceState(null, "", url.toString());
    }
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!status) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  const host = status.origin ? new URL(status.origin).host : null;
  return (
    <div className="grid gap-6">
      <Section
        title="OpenReader"
        description="Read-aloud and paper podcasts speak through your OpenReader account, with its speech providers, voices and limits."
        actions={status.connected ? <Badge tone="accent">Connected</Badge> : undefined}
      >
        {!status.configured ? (
          <Row
            label="Not set up"
            description={isAdmin ? "Set the OpenReader instance in Admin → OpenReader first." : "An admin hasn't set up an OpenReader instance yet."}
          >
            <span />
          </Row>
        ) : status.connected ? (
          <Row
            label={host ?? "OpenReader"}
            description="This app can generate speech as you and list your voices. It can't change your library."
          >
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button asChild variant="ghost" size="sm">
                <a href={status.origin ?? "#"} target="_blank" rel="noreferrer">
                  Open <ExternalLink />
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await fetch("/api/openreader", { method: "DELETE" });
                    toast.success("OpenReader disconnected");
                    await load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          </Row>
        ) : (
          <Row
            label={host ?? "OpenReader"}
            description={status.canConnect ? "You'll sign in to OpenReader and approve speech access for this app." : "Create an account to connect OpenReader."}
          >
            <Button asChild={status.canConnect} disabled={!status.canConnect} size="sm">
              {status.canConnect ? <a href="/api/openreader/connect">Connect OpenReader</a> : <span>Connect OpenReader</span>}
            </Button>
          </Row>
        )}
      </Section>
      {status.connected && <HostVoices initial={status.hostVoices} />}
    </div>
  );
}

function HostVoices({ initial }: { initial: string[] }) {
  const [voices, setVoices] = useState<Voices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([initial[0] ?? "", initial[1] ?? ""]);

  useEffect(() => {
    api<Voices>("/api/openreader/voices").then(setVoices, (e: Error) => setError(e.message));
  }, []);

  const save = async (index: number, value: string) => {
    const next = chosen.map((v, i) => (i === index ? value : v));
    setChosen(next);
    try {
      await api("/api/openreader", { method: "PUT", body: JSON.stringify({ hostVoices: next }) });
      toast.success("Voice saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the voice");
    }
  };

  const picker = (index: number, label: string) => (
    <Select value={chosen[index] || SAVED} onValueChange={(v) => save(index, v === SAVED ? "" : v)}>
      <SelectTrigger className="w-full sm:w-64" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SAVED}>Your saved OpenReader voice</SelectItem>
        {/* Keep a chosen voice the provider no longer lists, so the picker still shows it. */}
        {chosen[index] && !voices?.voices.some((v) => v.id === chosen[index]) && (
          <SelectItem value={chosen[index]}>{chosen[index]}</SelectItem>
        )}
        {voices?.voices.map((v) => (
          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Section
      title="Voices"
      description={
        voices?.provider
          ? `From your saved OpenReader speech provider (${voices.provider}${voices.model ? `, ${voices.model}` : ""}). Change the provider in OpenReader.`
          : "From your saved OpenReader speech provider."
      }
    >
      {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}
      {!voices && !error && <Loader2 className="m-5 size-4 animate-spin text-muted-foreground" />}
      {voices && (
        <>
          <Row label="Host 1" description="Reads replies aloud and opens paper podcasts.">{picker(0, "Host 1 voice")}</Row>
          <Row label="Host 2" description="The second podcast host. Pick a different voice so the two are easy to tell apart.">{picker(1, "Host 2 voice")}</Row>
        </>
      )}
    </Section>
  );
}
