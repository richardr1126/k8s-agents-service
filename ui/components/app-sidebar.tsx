import * as React from "react"
import { Github, MessagesSquare, Shield, LogOut, User, UserPlus } from "lucide-react"
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
  };

  const handleCreateAccount = () => {
    router.push("/signup");
  };

  const handleSignIn = () => {
    router.push("/signin");
  };

  // Check if user is anonymous using the isAnonymous field from better-auth
  // Use Record<string, unknown> for session.user if type is unknown
  const isAnonymous = session?.user && (session.user as Record<string, unknown>).isAnonymous === true;

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
                <Link href="https://chat.richardr.dev" target="_blank">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <MessagesSquare className="size-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
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
      <SidebarFooter>
        <SidebarMenu>
          {session && !isAnonymous && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
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
                <div className="flex flex-col gap-0.5 leading-none text-left">
                  <span className="font-semibold">{session.user.name || session.user.email}</span>
                  <span className="text-xs opacity-60">Signed in</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          
          {isAnonymous && (
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={handleCreateAccount}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <UserPlus className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none text-left">
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
                  <span className="text-xs opacity-60">
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
                <div className="flex flex-col gap-0.5 leading-none text-left">
                  <span className="font-semibold">Sign Out</span>
                  <span className="text-xs opacity-60">Logout</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" asChild>
              <Link href="https://github.com/richardr1126/k8s-agents-service" target="_blank">
                <div className="flex aspect-square size-5 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
                  <Github className="size-3" />
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
