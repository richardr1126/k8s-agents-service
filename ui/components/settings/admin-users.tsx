"use client";

import { Loader2, MoreHorizontal, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { api, Badge, Section } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  adminSource: string | null;
  accessStatus: "active" | "pending" | "suspended";
  runLimitExempt: boolean;
  createdAt: string;
  threadCount: number;
};

type Filter = "all" | "pending" | "suspended";
type Patch = Partial<Pick<AdminUser, "isAdmin" | "accessStatus" | "runLimitExempt">>;

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function UserAdmin() {
  const { data: session } = useSession();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [guests, setGuests] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (filter !== "all") params.set("status", filter);
    try {
      const [r, pending] = await Promise.all([
        api<{ users: AdminUser[]; guests: number }>(`/api/admin/users?${params}`),
        api<{ users: AdminUser[] }>("/api/admin/users?status=pending"),
      ]);
      if (id !== seq.current) return;
      setUsers(r.users);
      setGuests(r.guests);
      setPendingCount(pending.users.length);
      setLoadError(null);
    } catch (e) {
      if (id === seq.current) setLoadError(e instanceof Error ? e.message : "Couldn't load users");
    }
  }, [query, filter]);

  // Refreshes after a change use the search and filter current at that time, not when the change started.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const reload = () => loadRef.current();

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(user: AdminUser, change: Patch, done: string) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(change) });
      toast.success(done);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update");
    }
  }

  async function remove(user: AdminUser) {
    const ok = await confirm({
      title: `Delete ${user.email}?`,
      description: `This deletes the account and its ${user.threadCount} conversation${user.threadCount === 1 ? "" : "s"}, and can't be undone.`,
      confirmLabel: "Delete account",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      toast.success(`Deleted ${user.email}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: pendingCount ? `Waiting (${pendingCount})` : "Waiting" },
    { id: "suspended", label: "Suspended" },
  ];

  return (
    <Section
      title="Users"
      description={`Accounts on the site${guests ? `, plus ${guests} guest session${guests === 1 ? "" : "s"}` : ""}. Changes apply on each person's next request.`}
    >
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium", filter === f.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loadError && users === null ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm">
          <span className="text-red-600 dark:text-red-400">{loadError}</span>
          <Button size="sm" variant="outline" onClick={reload}>Try again</Button>
        </div>
      ) : users === null ? (
        <div className="px-5 py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : users.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No accounts match.</p>
      ) : (
        users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            self={u.id === session?.user.id}
            onPatch={(change, done) => patch(u, change, done)}
            onDelete={() => remove(u)}
          />
        ))
      )}
    </Section>
  );
}

function UserRow({ user, self, onPatch, onDelete }: { user: AdminUser; self: boolean; onPatch: (change: Patch, done: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const item = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={cn("w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-muted", danger && "text-red-600 dark:text-red-400")}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{user.name || user.email}</span>
          {self && <Badge>You</Badge>}
          {user.isAdmin && <Badge tone="accent">Admin</Badge>}
          {user.adminSource === "bootstrap" && <Badge tone="warn">Admin after password change</Badge>}
          {user.accessStatus === "pending" && <Badge tone="warn">Waiting for approval</Badge>}
          {user.accessStatus === "suspended" && <Badge tone="danger">Suspended</Badge>}
          {user.runLimitExempt && <Badge>Unlimited runs</Badge>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {user.email}
          {!user.emailVerified && " · not confirmed"} · joined {date.format(new Date(user.createdAt))} · {user.threadCount} chat{user.threadCount === 1 ? "" : "s"}
        </div>
      </div>
      {user.accessStatus === "pending" && (
        <Button size="sm" onClick={() => onPatch({ accessStatus: "active" }, `Approved ${user.email}`)}>Approve</Button>
      )}
      {!self && (
        <div ref={menuRef} className="relative">
          <Button size="icon" variant="ghost" className="size-8" aria-label={`Actions for ${user.email}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <MoreHorizontal className="size-4" />
          </Button>
          {open && (
            <div role="menu" className="absolute right-0 top-9 z-20 w-52 rounded-lg border bg-popover p-1 shadow-lg">
              {user.isAdmin
                ? item("Remove admin", () => onPatch({ isAdmin: false }, `${user.email} is no longer an admin`))
                : item("Make admin", () => onPatch({ isAdmin: true }, `${user.email} is now an admin`))}
              {user.runLimitExempt
                ? item("Apply run limits", () => onPatch({ runLimitExempt: false }, `Run limits apply to ${user.email}`))
                : item("Allow unlimited runs", () => onPatch({ runLimitExempt: true }, `${user.email} has unlimited runs`))}
              {user.accessStatus === "suspended"
                ? item("Restore access", () => onPatch({ accessStatus: "active" }, `Restored ${user.email}`))
                : item("Suspend", () => onPatch({ accessStatus: "suspended" }, `Suspended ${user.email}`), true)}
              {item("Delete account", onDelete, true)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
