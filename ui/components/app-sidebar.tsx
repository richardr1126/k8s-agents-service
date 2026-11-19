"use client";

import {
  ChevronsUpDownIcon,
  LogInIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  UserIcon,
  UserPlusIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { showPrivacyPopup } from "@/components/privacy-popup";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GitHubIcon } from "@/components/ui/icons";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";
import { signOut, useSession } from "@/lib/auth-client";

const SOURCE_URL = "https://github.com/richardr1126/k8s-agents-service";

type Theme = "light" | "dark" | "system";

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem("theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function Avatar({ name, image, className = "size-7" }: { name: string; image?: string | null; className?: string }) {
  return (
    <span className={`bg-muted text-muted-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-full border ${className}`}>
      {image ? (
        <Image src={image} alt="" width={32} height={32} className="size-full object-cover" />
      ) : name ? (
        <span className="text-[11px] font-semibold uppercase">{name.slice(0, 1)}</span>
      ) : (
        <UserIcon className="size-3.5" />
      )}
    </span>
  );
}

function AccountMenu() {
  const { data: session } = useSession();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(storedTheme);
  if (!session) return null;
  const user = session.user;
  const guest = user.isAnonymous === true;
  const name = guest ? "Guest" : user.name || user.email;

  const changeTheme = (value: string) => {
    const next = value as Theme;
    setTheme(next);
    window.__setTheme?.(next === "system" ? null : next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-lg p-2 text-left outline-none focus-visible:ring-2"
        >
          <Avatar name={guest ? "" : name} image={user.image} className="size-8" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {guest ? "Guest session" : user.isAdmin ? "Admin" : user.email}
            </span>
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        {!guest && (
          <>
            <DropdownMenuLabel className="text-muted-foreground truncate text-xs font-normal">{user.email}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <SettingsIcon />
                {user.isAdmin ? "Settings & admin" : "Settings"}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <MoonIcon /> : theme === "light" ? <SunIcon /> : <MonitorIcon />}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            <GitHubIcon />
            Source code
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => showPrivacyPopup()}>
          <ShieldIcon />
          Privacy policy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {guest ? (
          <DropdownMenuItem onSelect={() => router.push("/signin")}>
            <LogInIcon />
            Sign in
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={async () => {
              await signOut();
              router.push("/signin");
            }}
          >
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Guests keep their chats only in this browser; nudge them toward an account. */
function GuestPrompt() {
  const { data: session } = useSession();
  if (!session?.user.isAnonymous) return null;
  return (
    <div className="bg-background mx-0.5 mb-1 rounded-lg border p-3 text-sm dark:bg-card">
      <p className="font-medium">Save your chats</p>
      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
        Create an account to keep your conversations and pick them up anywhere.
      </p>
      <Button asChild size="sm" className="mt-2.5 w-full">
        <Link href="/signup">
          <UserPlusIcon />
          Create account
        </Link>
      </Button>
    </div>
  );
}

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader className="px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
        <Link href="/" className="flex h-8 items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark />
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-1">
        <ThreadList />
      </SidebarContent>
      <SidebarRail />
      <SidebarFooter className="border-sidebar-border gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <GuestPrompt />
        <AccountMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
