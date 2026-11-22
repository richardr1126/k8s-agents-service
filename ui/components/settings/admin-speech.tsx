"use client";

import { ChevronLeft, ExternalLink, Loader2, MoreHorizontal, Play, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { api, Badge, Row, Section, Toggle } from "@/components/settings/parts";
import { EXTERNAL_PROVIDER_ORDER, PROVIDER_BRANDS, ProviderLogo } from "@/components/settings/provider-brands";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  isBuiltInTtsProviderId,
  resolveProviderModels,
  supportsTtsInstructions,
  type TtsProviderId,
} from "@/lib/tts/provider-catalog";
import { defaultModelForProviderType, defaultVoiceForProviderType } from "@/lib/tts/provider-policy";

/**
 * Speech providers, ported from OpenReader's admin providers: pick a service by
 * its logo, fill in what it needs, check it, save. Below them, the provider and
 * two host voices the paper podcast speaks with.
 */

type ProviderType = Exclude<TtsProviderId, "kokoro-local">;

export type MaskedProvider = {
  id: string;
  slug: string;
  displayName: string;
  providerType: ProviderType;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  defaultModel: string | null;
  defaultVoice: string | null;
  defaultInstructions: string | null;
  defaultModelOptions: string | null;
  enabled: boolean;
};

type CheckItem = { id: string; label: string; status: "ok" | "warn" | "error" | "skipped"; detail: string };
type Speech = { provider: string | null; hostVoices: [string, string]; speed: number };

type Form = {
  slug: string;
  displayName: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultVoice: string;
  defaultInstructions: string;
  defaultModelOptions: string;
  enabled: boolean;
};

const CHECK_BADGE: Record<CheckItem["status"], { tone: BadgeTone; label: string }> = {
  ok: { tone: "ok", label: "OK" },
  warn: { tone: "warn", label: "Check" },
  error: { tone: "danger", label: "Fix" },
  skipped: { tone: "muted", label: "Skipped" },
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** The slug a new provider gets from its name, numbered past any taken one. */
function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!base || (!taken.has(base) && !isBuiltInTtsProviderId(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 64 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate) && !isBuiltInTtsProviderId(candidate)) return candidate;
  }
}

function formFor(providerType: ProviderType, taken: ReadonlySet<string>): Form {
  const displayName = providerType === "custom-openai" ? "" : PROVIDER_BRANDS[providerType].name;
  return {
    slug: uniqueSlug(displayName, taken),
    displayName,
    providerType,
    baseUrl: "",
    apiKey: "",
    defaultModel: defaultModelForProviderType(providerType),
    defaultVoice: "",
    defaultInstructions: "",
    defaultModelOptions: "",
    enabled: true,
  };
}

function formFrom(p: MaskedProvider): Form {
  return {
    slug: p.slug,
    displayName: p.displayName,
    providerType: p.providerType,
    baseUrl: p.baseUrl ?? "",
    apiKey: "",
    defaultModel: p.defaultModel ?? defaultModelForProviderType(p.providerType),
    defaultVoice: p.defaultVoice ?? "",
    defaultInstructions: p.defaultInstructions ?? "",
    defaultModelOptions: p.defaultModelOptions ?? "",
    enabled: p.enabled,
  };
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What the check and voice routes need to describe a provider, saved or not. */
function draftOf(form: Form, id?: string) {
  return {
    ...(id && { id }),
    providerType: form.providerType,
    baseUrl: form.baseUrl.trim(),
    ...(form.apiKey && { apiKey: form.apiKey.trim() }),
    defaultModel: form.defaultModel.trim(),
    defaultVoice: form.defaultVoice.trim(),
    defaultInstructions: supportsTtsInstructions(form.defaultModel, form.providerType) ? form.defaultInstructions.trim() : "",
    defaultModelOptions: form.providerType === "openrouter" ? form.defaultModelOptions.trim() : "",
  };
}

/** The voices a provider offers, fetched when its description settles. */
function useVoices(draft: ReturnType<typeof draftOf> | null) {
  const [found, setFound] = useState<{ key: string; voices: string[] }>({ key: "", voices: [] });
  const key = draft ? JSON.stringify({ ...draft, defaultVoice: "", defaultInstructions: "" }) : "";
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ voices: string[] }>("/api/admin/tts/voices", { method: "POST", body: key, signal: controller.signal }).then(
        (r) => setFound({ key, voices: r.voices }),
        () => setFound({ key, voices: [] }),
      );
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);
  return found.key === key ? found.voices : [];
}

/** An input that suggests options but accepts any value. */
function Suggest({ options, ...props }: React.ComponentProps<typeof Input> & { options: readonly string[] }) {
  const listId = useId();
  return (
    <>
      <Input list={options.length ? listId : undefined} {...props} />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function SpeechSettings() {
  const { confirm } = useDialogs();
  const [providers, setProviders] = useState<MaskedProvider[] | undefined>(undefined);
  const [editing, setEditing] = useState<MaskedProvider | "new" | null>(null);

  const load = useCallback(
    () =>
      api<{ providers: MaskedProvider[] }>("/api/admin/tts/providers").then(
        (r) => setProviders(r.providers),
        (e: Error) => toast.error(e.message),
      ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const taken = useMemo(() => new Set((providers ?? []).map((p) => p.slug)), [providers]);

  async function patch(p: MaskedProvider, changes: Partial<Form>) {
    try {
      await api(`/api/admin/tts/providers/${p.id}`, { method: "PATCH", body: JSON.stringify({ ...formFrom(p), apiKey: undefined, ...changes }) });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update");
    }
  }

  async function remove(p: MaskedProvider) {
    const ok = await confirm({
      title: `Delete ${p.displayName}?`,
      description: "Its saved key is deleted. Podcasts set to use it stop until you pick another provider.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/tts/providers/${p.id}`, { method: "DELETE" });
      toast.success("Provider deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  }

  return (
    <>
      <Section
        title="Speech providers"
        description="Text-to-speech services the assistant can speak with, such as for paper podcasts. Keys are stored encrypted."
      >
        {providers === undefined ? (
          <div className="px-5 py-4">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : providers.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">No providers yet.</p>
        ) : (
          providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className={p.enabled ? undefined : "opacity-50"}>
                <ProviderLogo providerType={p.providerType} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate text-sm font-medium ${p.enabled ? "" : "text-muted-foreground"}`}>{p.displayName}</span>
                  {!p.enabled && <Badge>Off</Badge>}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
                  {p.defaultModel ?? defaultModelForProviderType(p.providerType)}
                  {p.baseUrl ? ` · ${host(p.baseUrl)}` : ""}
                  {p.apiKeyLast4 ? ` · key …${p.apiKeyLast4}` : ""}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.displayName}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(p)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => patch(p, { enabled: !p.enabled })}>{p.enabled ? "Turn off" : "Turn on"}</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => remove(p)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
        {providers !== undefined && (
          <div className="px-3 py-2 sm:px-4">
            <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
              <Plus />
              Add provider
            </Button>
          </div>
        )}
      </Section>

      {providers && <PodcastVoices providers={providers} />}

      <ProviderDialog
        target={editing}
        taken={taken}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </>
  );
}

function ProviderDialog({
  target,
  taken,
  onClose,
  onSaved,
}: {
  target: MaskedProvider | "new" | null;
  taken: ReadonlySet<string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const editing = target && target !== "new" ? target : null;
  const [form, setForm] = useState<Form | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [checks, setChecks] = useState<{ key: string; items: CheckItem[] } | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);

  // Each new target starts from a fresh form.
  const [formTarget, setFormTarget] = useState<typeof target>(null);
  if (formTarget !== target) {
    setFormTarget(target);
    if (target) {
      setForm(editing ? formFrom(editing) : null);
      setSlugEdited(false);
      setChecks(null);
    }
  }

  const update = (changes: Partial<Form>) =>
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      if (!editing && !slugEdited && changes.displayName !== undefined) next.slug = uniqueSlug(next.displayName, taken);
      return next;
    });

  const draft = form ? draftOf(form, editing?.id) : null;
  const checkKey = JSON.stringify(draft);
  const voices = useVoices(form && (form.providerType !== "custom-openai" || form.baseUrl) ? draft : null);
  const models = useMemo(() => (form ? resolveProviderModels(form.providerType) : []), [form]);
  const brand = form ? PROVIDER_BRANDS[form.providerType] : null;
  const isCustom = form?.providerType === "custom-openai";
  const needsKey = !!form && !isCustom && !form.apiKey && !editing?.hasApiKey;
  const canSave = !!form && form.slug.trim() && form.displayName.trim() && (!isCustom || form.baseUrl.trim()) && !needsKey;

  async function check() {
    if (!draft) return;
    setBusy("check");
    try {
      const r = await api<{ items: CheckItem[] }>("/api/admin/tts/check", { method: "POST", body: checkKey });
      setChecks({ key: checkKey, items: r.items });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    setBusy("save");
    const body = {
      slug: form.slug.trim(),
      displayName: form.displayName.trim(),
      providerType: form.providerType,
      baseUrl: form.baseUrl.trim() || null,
      ...(form.apiKey && { apiKey: form.apiKey.trim() }),
      defaultModel: form.defaultModel.trim() || null,
      defaultVoice: form.defaultVoice.trim() || null,
      defaultInstructions: draft?.defaultInstructions || null,
      defaultModelOptions: draft?.defaultModelOptions || null,
      enabled: form.enabled,
    };
    try {
      await api(editing ? `/api/admin/tts/providers/${editing.id}` : "/api/admin/tts/providers", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      toast.success(editing ? "Provider updated" : "Provider added");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  const title = !form || !brand ? "Add provider" : editing ? `Edit ${editing.displayName}` : `Add ${brand.name}`;
  const visibleChecks = checks?.key === checkKey ? checks.items : null;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {form && <ProviderLogo providerType={form.providerType} size="lg" />}
            <div className="min-w-0">
              <DialogTitle className="truncate">{title}</DialogTitle>
              <DialogDescription>{brand ? brand.summary : "Pick the service to connect."}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!form ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Provider services">
            {EXTERNAL_PROVIDER_ORDER.map((type) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => setForm(formFor(type as ProviderType, taken))}
                  className="hover:bg-accent focus-visible:ring-ring flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2"
                >
                  <ProviderLogo providerType={type} size="lg" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{PROVIDER_BRANDS[type].name}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">{PROVIDER_BRANDS[type].summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave && !busy) save();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {isCustom && (
                <Field label="Base URL" className="sm:col-span-2" hint="The server's OpenAI-compatible root, ending in /v1.">
                  {(c) => (
                    <Input {...c} type="url" value={form.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder="https://your-tts-host/v1" />
                  )}
                </Field>
              )}
              <Field label="Display name">
                {(c) => (
                  <Input {...c} value={form.displayName} onChange={(e) => update({ displayName: e.target.value })} placeholder={isCustom ? "Kokoro-FastAPI" : brand?.name} />
                )}
              </Field>
              <Field label="Model">
                {(c) => (
                  <Suggest
                    {...c}
                    options={models.map((m) => m.id).filter((id) => id !== "custom")}
                    value={form.defaultModel}
                    onChange={(e) => update({ defaultModel: e.target.value })}
                    placeholder={defaultModelForProviderType(form.providerType)}
                    className="font-mono text-xs"
                  />
                )}
              </Field>
              <Field
                label="API key"
                className="sm:col-span-2"
                action={
                  brand?.apiKeyUrl && (
                    <a href={brand.apiKeyUrl} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 text-xs hover:underline">
                      Get a key
                      <ExternalLink className="size-3" />
                    </a>
                  )
                }
              >
                {(c) => (
                  <Input
                    {...c}
                    type="password"
                    autoComplete="off"
                    className="font-mono text-xs"
                    value={form.apiKey}
                    onChange={(e) => update({ apiKey: e.target.value })}
                    placeholder={editing?.hasApiKey ? `Keep the saved key (…${editing.apiKeyLast4})` : isCustom ? "Optional" : ""}
                  />
                )}
              </Field>
              <Field label="Default voice" className="sm:col-span-2" hint={voices.length ? `${voices.length} voices available.` : undefined}>
                {(c) => (
                  <Suggest
                    {...c}
                    options={voices}
                    value={form.defaultVoice}
                    onChange={(e) => update({ defaultVoice: e.target.value })}
                    placeholder={defaultVoiceForProviderType(form.providerType) || "Provider default"}
                  />
                )}
              </Field>
              {supportsTtsInstructions(form.defaultModel, form.providerType) && (
                <Field label="Speaking instructions" className="sm:col-span-2" hint="Optional. How the voice should sound.">
                  {(c) => (
                    <textarea
                      {...c}
                      className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:border-ring min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                      value={form.defaultInstructions}
                      onChange={(e) => update({ defaultInstructions: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>

            <details className="rounded-lg border">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer rounded-lg px-3 py-2 text-sm font-medium select-none">Advanced</summary>
              <div className="grid gap-3 border-t px-3 py-3">
                <Field label="Slug" hint={editing ? "Podcasts refer to the provider by this." : "Podcasts refer to the provider by this. It can't change later."}>
                  {(c) => (
                    <Input
                      {...c}
                      className="font-mono text-xs"
                      value={form.slug}
                      disabled={!!editing}
                      onChange={(e) => {
                        setSlugEdited(true);
                        setForm((prev) => prev && { ...prev, slug: e.target.value });
                      }}
                    />
                  )}
                </Field>
                {form.providerType === "openrouter" && (
                  <Field label="Model options" hint="Optional JSON passed to the model, such as a reference voice.">
                    {(c) => (
                      <textarea
                        {...c}
                        className="border-input focus-visible:ring-ring/50 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                        value={form.defaultModelOptions}
                        onChange={(e) => update({ defaultModelOptions: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                <label className="flex items-center justify-between gap-3 text-sm">
                  On
                  <Toggle label="Provider on" checked={form.enabled} onChange={(v) => update({ enabled: v })} />
                </label>
              </div>
            </details>

            {visibleChecks && (
              <ul className="divide-y rounded-lg border" aria-label="Check results">
                {visibleChecks.map((item) => (
                  <li key={item.id} className="px-3 py-2" data-status={item.status}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.label}</span>
                      <Badge tone={CHECK_BADGE[item.status].tone}>{CHECK_BADGE[item.status].label}</Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{item.detail}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!editing && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}>
                  <ChevronLeft />
                  Back
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={check}>
                {busy === "check" ? <Loader2 className="animate-spin" /> : null}
                Check
              </Button>
              <span className="flex-1" />
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSave || busy !== null}>
                {busy === "save" ? <Loader2 className="animate-spin" /> : null}
                {editing ? "Save changes" : "Add provider"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const FIRST_ENABLED = "__first__";

function PodcastVoices({ providers }: { providers: MaskedProvider[] }) {
  const [speech, setSpeech] = useState<Speech | undefined>(undefined);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api<{ speech: Speech }>("/api/admin/tts/speech").then(
      (r) => {
        setSpeech(r.speech);
        setSaved(JSON.stringify(r.speech));
      },
      (e: Error) => toast.error(e.message),
    );
    return () => audio.current?.pause();
  }, []);

  const enabled = providers.filter((p) => p.enabled);
  const chosen = speech?.provider ? providers.find((p) => p.slug === speech.provider) : enabled[0];
  const voices = useVoices(chosen ? draftOf(formFrom(chosen), chosen.id) : null);

  if (!speech) return null;
  const dirty = JSON.stringify(speech) !== saved;

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ speech: Speech }>("/api/admin/tts/speech", { method: "PUT", body: JSON.stringify(speech) });
      setSpeech(r.speech);
      setSaved(JSON.stringify(r.speech));
      toast.success("Podcast voices saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function play(host: number) {
    audio.current?.pause();
    if (playing === host) return setPlaying(null);
    setPlaying(host);
    try {
      const res = await fetch("/api/admin/tts/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: chosen?.slug, voice: speech!.hostVoices[host] || chosen?.defaultVoice || undefined }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      const el = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = el;
      el.onended = () => setPlaying(null);
      await el.play();
    } catch (e) {
      setPlaying(null);
      toast.error(e instanceof Error ? e.message : "Couldn't play the sample");
    }
  }

  const setVoice = (host: number, value: string) =>
    setSpeech((s) => s && { ...s, hostVoices: (host === 0 ? [value, s.hostVoices[1]] : [s.hostVoices[0], value]) as [string, string] });

  return (
    <Section title="Paper podcasts" description="The provider and the two host voices the assistant's paper podcasts are spoken with.">
      <Row label="Provider" description="Leave on the first one to use whichever provider is listed first and on.">
        <Select
          value={speech.provider ?? FIRST_ENABLED}
          onValueChange={(v) => setSpeech({ ...speech, provider: v === FIRST_ENABLED ? null : v })}
          disabled={providers.length === 0}
        >
          <SelectTrigger className="w-full sm:w-72" aria-label="Podcast provider">
            <SelectValue placeholder="Add a provider first" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIRST_ENABLED}>First provider that&apos;s on{enabled[0] ? ` (${enabled[0].displayName})` : ""}</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.slug} value={p.slug} disabled={!p.enabled}>
                {p.displayName}
                {p.enabled ? "" : " (off)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {[0, 1].map((hostIndex) => (
        <Row key={hostIndex} label={`Host ${hostIndex + 1} voice`} description={hostIndex === 0 ? "Leads the conversation." : "Asks questions and reacts."}>
          <div className="flex w-full gap-2 sm:w-72">
            <Suggest
              options={voices}
              value={speech.hostVoices[hostIndex]}
              onChange={(e) => setVoice(hostIndex, e.target.value)}
              placeholder={chosen?.defaultVoice || (chosen ? defaultVoiceForProviderType(chosen.providerType) : "") || "Provider default"}
              aria-label={`Host ${hostIndex + 1} voice`}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={!chosen || (playing !== null && playing !== hostIndex)}
              onClick={() => play(hostIndex)}
              aria-label={playing === hostIndex ? `Stop host ${hostIndex + 1} sample` : `Play host ${hostIndex + 1} sample`}
            >
              {playing === hostIndex ? <Square /> : <Play />}
            </Button>
          </div>
        </Row>
      ))}
      <Row label="Speed" description="How fast both hosts speak.">
        <div className="flex w-full items-center gap-3 sm:w-72">
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={speech.speed}
            onChange={(e) => setSpeech({ ...speech, speed: Number(e.target.value) })}
            className="flex-1 accent-[var(--brand)]"
            aria-label="Speed"
          />
          <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{speech.speed.toFixed(2)}×</span>
        </div>
      </Row>
      <div className="flex justify-end px-5 py-4">
        <Button disabled={!dirty || busy} onClick={save}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </Section>
  );
}
