"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { createContext, Fragment, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, Choice, Row, Section, SourceBadge, Toggle } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SETTINGS, type SettingKey, type Settings } from "@/lib/settings/definitions";

type Source = "default" | "json-seed" | "admin";
type Snapshot = { values: Settings; sources: Record<SettingKey, Source>; defaults: Settings };

type Ctx = Snapshot & {
  save: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<boolean>;
  reset: (key: SettingKey) => Promise<void>;
};

const SettingsContext = createContext<Ctx | null>(null);

function useAdminSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useAdminSettings needs SettingsProvider");
  return ctx;
}

/** Loads admin settings once for every admin tab. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Snapshot>("/api/admin/settings").then(setSnapshot, (e: Error) => setError(e.message));
  }, []);

  const save = useCallback(async <K extends SettingKey>(key: K, value: Settings[K]) => {
    try {
      const res = await api<{ value: Settings[K] }>("/api/admin/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
      setSnapshot((s) => s && { ...s, values: { ...s.values, [key]: res.value }, sources: { ...s.sources, [key]: "admin" } });
      toast.success(`${SETTINGS[key].label} saved`);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      return false;
    }
  }, []);

  const reset = useCallback(async (key: SettingKey) => {
    try {
      const res = await api<{ value: unknown }>(`/api/admin/settings?key=${key}`, { method: "DELETE" });
      setSnapshot((s) => s && { ...s, values: { ...s.values, [key]: res.value }, sources: { ...s.sources, [key]: "default" } });
      toast.success(`${SETTINGS[key].label} reset to the default`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reset");
    }
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!snapshot) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  return <SettingsContext.Provider value={{ ...snapshot, save, reset }}>{children}</SettingsContext.Provider>;
}

/** Label, description and source badge from the definition, with a reset button once changed. */
function SettingRow({ k, children }: { k: SettingKey; children: ReactNode }) {
  const { sources, reset } = useAdminSettings();
  const source = sources[k];
  return (
    <Row
      label={SETTINGS[k].label}
      description={SETTINGS[k].description}
      badge={<SourceBadge source={source} />}
    >
      {children}
      {source !== "default" && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => reset(k)}>
          <RotateCcw className="size-3" /> Reset to default
        </Button>
      )}
    </Row>
  );
}

export function AccessSettings() {
  const { values, save } = useAdminSettings();
  return (
    <Section title="Access" description="Who can use the site. Changes apply on each person's next request.">
      <SettingRow k="signupPolicy">
        <Choice
          name="Sign-up policy"
          value={values.signupPolicy}
          onChange={(v) => save("signupPolicy", v)}
          options={[
            { value: "open", label: "Open", hint: "Anyone can create an account." },
            { value: "approval", label: "Approval", hint: "New accounts wait in Users until approved." },
            { value: "closed", label: "Closed", hint: "No new accounts." },
          ]}
        />
      </SettingRow>
      <SettingRow k="allowGuests">
        <Toggle label="Guest sessions" checked={values.allowGuests} onChange={(v) => save("allowGuests", v)} />
      </SettingRow>
    </Section>
  );
}

export function LimitSettings() {
  const { values, defaults, save } = useAdminSettings();
  const [draft, setDraft] = useState(values.runLimits);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(values.runLimits);
  if (synced !== values.runLimits) {
    // A save or reset elsewhere replaced the value; start the draft from it.
    setSynced(values.runLimits);
    setDraft(values.runLimits);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(values.runLimits);

  const field = (tier: "guest" | "user", window: "perMinute" | "perDay") => (
    <Input
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      aria-label={`${tier === "guest" ? "Guest" : "Account"} runs ${window === "perMinute" ? "per minute" : "per day"}`}
      value={draft[tier][window]}
      placeholder={String(defaults.runLimits[tier][window])}
      onChange={(e) => {
        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
        setDraft((d) => ({ ...d, [tier]: { ...d[tier], [window]: n } }));
      }}
    />
  );

  return (
    <Section
      title="Run limits"
      description="How many agent runs each person may start. 0 turns a window off. Admins and accounts marked unlimited in Users have no limit."
    >
      <SettingRow k="runLimits">
        <div className="grid w-full gap-3 sm:max-w-xs">
          <div className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-x-2 gap-y-2">
            <span />
            <span className="text-xs text-muted-foreground">Per minute</span>
            <span className="text-xs text-muted-foreground">Per day</span>
            {(["guest", "user"] as const).map((tier) => (
              <Fragment key={tier}>
                <span className="text-sm font-medium">{tier === "guest" ? "Guests" : "Accounts"}</span>
                {field(tier, "perMinute")}
                {field(tier, "perDay")}
              </Fragment>
            ))}
          </div>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(values.runLimits)}>Discard</Button>
            <Button
              disabled={!dirty || saving}
              onClick={async () => {
                setSaving(true);
                await save("runLimits", draft);
                setSaving(false);
              }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save limits"}
            </Button>
          </div>
        </div>
      </SettingRow>
    </Section>
  );
}

export function ModelSettings() {
  const { values, save } = useAdminSettings();
  const [backend, setBackend] = useState<{ models: string[]; backendDefault: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>(values.enabledModels);
  const [titleModel, setTitleModel] = useState(values.titleModel);
  // Each draft follows only its own saved value, so saving one setting keeps the other's unsaved edits.
  const [syncedEnabled, setSyncedEnabled] = useState(values.enabledModels);
  if (syncedEnabled !== values.enabledModels) {
    setSyncedEnabled(values.enabledModels);
    setEnabled(values.enabledModels);
  }
  const [syncedTitle, setSyncedTitle] = useState(values.titleModel);
  if (syncedTitle !== values.titleModel) {
    setSyncedTitle(values.titleModel);
    setTitleModel(values.titleModel);
  }

  useEffect(() => {
    api<{ models: string[]; backendDefault: string }>("/api/admin/models").then(setBackend, (e: Error) => setError(e.message));
  }, []);

  const allOn = enabled.length === 0;
  const isOn = (m: string) => allOn || enabled.includes(m);
  const toggle = (m: string, on: boolean) => {
    const current = allOn ? backend!.models : enabled;
    const next = on ? [...current, m] : current.filter((x) => x !== m);
    // Every model on is stored as "all", so models the backend adds later are offered too.
    setEnabled(next.length === backend!.models.length ? [] : next);
  };
  const enabledDirty = JSON.stringify([...enabled].sort()) !== JSON.stringify([...values.enabledModels].sort());
  const offered = backend ? backend.models.filter(isOn) : [];

  return (
    <div className="grid gap-6">
      <Section title="Chat models" description="Models come from the agent service; choose which ones people can pick.">
        <SettingRow k="enabledModels">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!backend && !error && <Loader2 className="size-4 animate-spin" />}
          {backend && (
            <div className="grid w-full gap-1 sm:max-w-sm">
              {backend.models.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                  <Checkbox
                    checked={isOn(m)}
                    disabled={isOn(m) && offered.length === 1}
                    onCheckedChange={(c) => toggle(m, Boolean(c))}
                  />
                  <span className="truncate font-mono text-xs">{m}</span>
                </label>
              ))}
              <div className="flex gap-2 pt-2 sm:justify-end">
                <Button variant="ghost" disabled={!enabledDirty} onClick={() => setEnabled(values.enabledModels)}>Discard</Button>
                <Button disabled={!enabledDirty} onClick={() => save("enabledModels", enabled)}>Save models</Button>
              </div>
            </div>
          )}
        </SettingRow>
        <SettingRow k="defaultModel">
          {backend && (
            <Select
              value={values.defaultModel ?? "__backend__"}
              onValueChange={(v) => save("defaultModel", v === "__backend__" ? null : v)}
            >
              <SelectTrigger className="w-full sm:w-72" aria-label="Default model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__backend__">Agent service default ({backend.backendDefault})</SelectItem>
                {offered.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
      </Section>

      <Section title="Chat names" description="New chats get a short name from a small model after the first message.">
        <SettingRow k="autoTitle">
          <Toggle label="Name new chats automatically" checked={values.autoTitle} onChange={(v) => save("autoTitle", v)} />
        </SettingRow>
        <SettingRow k="titleModel">
          <form
            className="flex w-full gap-2 sm:max-w-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (titleModel.trim()) save("titleModel", titleModel.trim());
            }}
          >
            <Input className="font-mono text-xs" value={titleModel} onChange={(e) => setTitleModel(e.target.value)} aria-label="Title model" disabled={!values.autoTitle} />
            <Button type="submit" variant="outline" disabled={!values.autoTitle || !titleModel.trim() || titleModel.trim() === values.titleModel}>Save</Button>
          </form>
        </SettingRow>
      </Section>
    </div>
  );
}
