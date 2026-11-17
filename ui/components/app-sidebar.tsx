import * as React from "react"
import { MessagesSquare, Settings, Shield, LogOut, User, UserPlus } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ThreadList } from "@/components/assistant-ui/thread-list"
import { showPrivacyPopup } from "@/components/privacy-popup"
import { signOut, useSession } from "@/lib/auth-client"
import { useRouter } from "next/navigation"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/signin");
  };

  const handleCreateAccount = () => {
    router.push("/signup");
  };

  const handleSignIn = () => {
    router.push("/signin");
  };

  const isAnonymous = session?.user.isAnonymous === true;

  return (
    <Sidebar {...props} >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
                <Link href="https://chat.richardr.dev" target="_blank">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <MessagesSquare className="size-4" />
                  </div>
                  <div className="flex flex-col text-[1.1rem] md:text-[0.92rem] leading-none">
                    <span className="font-semibold">chat.richardr.dev</span>
                  </div>
                </Link>
              </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ThreadList />
      </SidebarContent>
      
      <SidebarRail />
      <SidebarFooter className="mb-3">
        <SidebarMenu>
          {session && !isAnonymous && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/settings">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-hidden">
                  {session.user.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name || "User avatar"}
                      width={32}
                      height={32}
                      className="rounded-lg object-cover"
                    />
                  ) : (
                    <User className="size-4" />
                  )}
                </div>
                <div className="flex flex-col leading-none text-left">
                  <span className="font-semibold">{session.user.name || session.user.email}</span>
                  <span className="text-sm md:text-xs opacity-60">{session.user.isAdmin ? "Admin · Settings" : "Account settings"}</span>
                </div>
                <Settings className="ml-auto size-4 opacity-60" />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          
          {isAnonymous && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={handleCreateAccount}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <UserPlus className="size-4" />
                </div>
                <div className="flex flex-col leading-none text-left">
                  <span className="font-semibold">
                    Create Account or&nbsp;
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSignIn();
                      }}
                      className="underline hover:opacity-80 cursor-pointer"
                    >
                      Sign in
                    </span>
                  </span>
                  <span className="text-sm md:text-xs opacity-60">
                    Manage your chats and data
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          
          {session && !isAnonymous && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={handleSignOut}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <LogOut className="size-4" />
                </div>
                <div className="flex flex-col leading-none text-left">
                  <span className="font-semibold">Sign Out</span>
                  <span className="text-sm md:text-xs opacity-60">Logout</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" asChild>
              <Link href="https://github.com/richardr1126/k8s-agents-service" target="_blank">
                <div className="flex aspect-square size-5 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
                  <svg className="size-3" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
                    />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Source Code</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" onClick={() => showPrivacyPopup()}>
              <div className="flex aspect-square size-5 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
                <Shield className="size-3" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none text-left">
                <span className="font-semibold">Privacy Policy</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
