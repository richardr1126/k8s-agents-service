"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BotIcon,
  ClockIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  SearchIcon,
  TelescopeIcon,
  TerminalIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { callTitle, describeCall, type Call, type Catalog } from "@/lib/commands";
import { skillsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** The icons a skill's `ui.icon` can name, each with its colour. */
const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  bot: { icon: BotIcon, tone: "text-violet-500 dark:text-violet-400" },
  clock: { icon: ClockIcon, tone: "text-amber-500 dark:text-amber-400" },
  "file-text": { icon: FileTextIcon, tone: "text-rose-500 dark:text-rose-400" },
  github: { icon: GitBranchIcon, tone: "text-foreground/70" },
  globe: { icon: GlobeIcon, tone: "text-blue-500 dark:text-blue-400" },
  search: { icon: SearchIcon, tone: "text-blue-500 dark:text-blue-400" },
  telescope: { icon: TelescopeIcon, tone: "text-indigo-500 dark:text-indigo-400" },
  user: { icon: UserIcon, tone: "text-emerald-500 dark:text-emerald-400" },
};

const COMMAND = { icon: TerminalIcon, tone: "text-orange-500 dark:text-orange-400" };

/** The catalog once it has loaded; cards draw a plain look until then. */
export function useCatalog(): Catalog | undefined {
  return useQuery(skillsQuery).data;
}

export function skillIcon(name: string | undefined, className?: string): ReactNode {
  const { icon: Icon, tone } = (name && ICONS[name]) || COMMAND;
  return <Icon className={cn("size-3.5 shrink-0", tone, className)} />;
}

/** How a tool row shows a command: the skill's icon and name, and what it's about. */
export type ToolView = { icon: ReactNode; label: string; detail?: string | null; argsText?: string };

export function commandView(call: Call): ToolView {
  const { label, detail } = callTitle(call);
  return { icon: skillIcon(call.skill?.ui.icon), label, detail, argsText: call.command };
}

/** A tool call's command and its look, or null for a tool that isn't a command. */
export function useCall(toolName: string, args: unknown): Call | null {
  const catalog = useCatalog();
  return describeCall(toolName, (args ?? {}) as Record<string, unknown>, catalog);
}
