import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings, parseSetting, SETTING_KEYS, SETTINGS, seedJsonSchema, seedSchema } from "./definitions";

describe("settings definitions", () => {
  it("defaults fit their own schemas", () => {
    for (const key of SETTING_KEYS) expect(SETTINGS[key].schema.safeParse(SETTINGS[key].default).success).toBe(true);
  });

  it("defaultSettings returns a fresh copy", () => {
    const a = defaultSettings();
    a.runLimits.guest.perDay = 99;
    expect(defaultSettings().runLimits.guest.perDay).toBe(3);
  });

  it("rejects values that do not fit", () => {
    expect(parseSetting("signupPolicy", "maybe")).toBeUndefined();
    expect(parseSetting("runLimits", { guest: { perMinute: -1, perDay: 1 }, user: { perMinute: 1, perDay: 1 } })).toBeUndefined();
  });

  it("seed rejects unknown keys and wrong versions", () => {
    expect(seedSchema.safeParse({ version: 1, settings: { nope: true } }).success).toBe(false);
    expect(seedSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(seedSchema.safeParse({ version: 1, settings: { allowGuests: false } }).success).toBe(true);
  });

  it("settings.example.json is a valid seed", () => {
    const example = JSON.parse(readFileSync(new URL("../../settings.example.json", import.meta.url), "utf8"));
    expect(seedSchema.safeParse(example).success).toBe(true);
  });

  it("settings.schema.json is current (run pnpm settings:schema)", () => {
    const committed = JSON.parse(readFileSync(new URL("../../settings.schema.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(seedJsonSchema())));
  });
});
