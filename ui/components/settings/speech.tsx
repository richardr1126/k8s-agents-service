"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, Badge, Row, Section } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Host = { provider?: string; model?: string; voice?: string };
type Status = { configured: boolean; origin: string | null; connected: boolean; hosts: Host[]; canConnect: boolean };
type Provider = { id: string; name: string; defaultModel: string; selected: boolean; selectedModel: string | null; models: { id: string; name: string }[] };
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
      {status.connected && <HostVoices initial={status.hosts} />}
    </div>
  );
}

function HostVoices({ initial }: { initial: Host[] }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hosts, setHosts] = useState<Host[]>([initial[0] ?? {}, initial[1] ?? {}]);

  useEffect(() => {
    api<{ providers: Provider[] }>("/api/openreader/providers").then((r) => setProviders(r.providers), (e: Error) => setError(e.message));
  }, []);

  const save = async (index: number, host: Host) => {
    const next = hosts.map((h, i) => (i === index ? host : h));
    setHosts(next);
    try {
      await api("/api/openreader", { method: "PUT", body: JSON.stringify({ hosts: next }) });
      toast.success("Voice saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the voice");
    }
  };

  const saved = providers?.find((p) => p.selected);
  return (
    <Section
      title="Voices"
      description={`Pick a speech provider, model and voice for each host, or follow your saved OpenReader settings${
        saved ? ` (${saved.name}${saved.selectedModel ? `, ${saved.selectedModel}` : ""})` : ""
      }. Speech counts against your OpenReader limits either way.`}
    >
      {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}
      {!providers && !error && <Loader2 className="m-5 size-4 animate-spin text-muted-foreground" />}
      {providers && (
        <>
          <Row label="Host 1" description="Reads replies aloud and opens paper podcasts.">
            <HostPicker label="Host 1" host={hosts[0]} providers={providers} onChange={(h) => save(0, h)} />
          </Row>
          <Row label="Host 2" description="The second podcast host. Pick a different voice so the two are easy to tell apart.">
            <HostPicker label="Host 2" host={hosts[1]} providers={providers} onChange={(h) => save(1, h)} />
          </Row>
        </>
      )}
    </Section>
  );
}

/** Provider, then its model, then a voice of that provider and model. */
function HostPicker({ label, host, providers, onChange }: { label: string; host: Host; providers: Provider[]; onChange: (host: Host) => void }) {
  const provider = providers.find((p) => p.id === host.provider);
  const params = new URLSearchParams();
  if (host.provider) params.set("provider", host.provider);
  if (host.provider && host.model) params.set("model", host.model);
  const key = params.toString();
  // Kept with the provider and model they're for, so a stale answer never shows.
  const [loaded, setLoaded] = useState<{ key: string; voices?: Voices; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    api<Voices>(`/api/openreader/voices${key ? `?${key}` : ""}`).then(
      (voices) => live && setLoaded({ key, voices }),
      (e: Error) => live && setLoaded({ key, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const voices = loaded?.key === key ? loaded.voices : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;

  const models = provider?.models ?? [];
  const defaultModel = provider && (models.find((m) => m.id === provider.defaultModel)?.name ?? provider.defaultModel);
  return (
    <>
      <Select value={host.provider || SAVED} onValueChange={(v) => onChange(v === SAVED ? {} : { provider: v })}>
        <SelectTrigger className="w-full sm:w-64" aria-label={`${label} speech provider`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAVED}>Your saved OpenReader provider</SelectItem>
          {/* Keep a chosen provider OpenReader no longer lists, so the picker still shows it. */}
          {host.provider && !provider && <SelectItem value={host.provider}>{host.provider}</SelectItem>}
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {host.provider && (
        <Select value={host.model || SAVED} onValueChange={(v) => onChange({ provider: host.provider, ...(v === SAVED ? {} : { model: v }) })}>
          <SelectTrigger className="w-full sm:w-64" aria-label={`${label} model`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SAVED}>{defaultModel ? `Default model (${defaultModel})` : "Default model"}</SelectItem>
            {host.model && !models.some((m) => m.id === host.model) && <SelectItem value={host.model}>{host.model}</SelectItem>}
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={host.voice || SAVED}
        disabled={!voices}
        onValueChange={(v) => onChange({ provider: host.provider, model: host.model, ...(v === SAVED ? {} : { voice: v }) })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={`${label} voice`}>
          {voices ? <SelectValue /> : <span className="text-muted-foreground">Loading voices…</span>}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAVED}>{host.provider ? "The provider's first voice" : "Your saved OpenReader voice"}</SelectItem>
          {host.voice && !voices?.voices.some((v) => v.id === host.voice) && <SelectItem value={host.voice}>{host.voice}</SelectItem>}
          {voices?.voices.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
