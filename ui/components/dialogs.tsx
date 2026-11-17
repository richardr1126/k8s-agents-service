"use client";

import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptOptions = {
  title: string;
  description?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  destructive?: boolean;
  inputType?: "text" | "password";
};

type Request =
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions);

type Dialogs = {
  /** Resolves true when the user confirms, false when they cancel or close the dialog. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves the entered text, or null when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const DialogsContext = createContext<Dialogs | null>(null);

export function useDialogs() {
  const context = useContext(DialogsContext);
  if (!context) throw new Error("useDialogs must be used inside DialogsProvider");
  return context;
}

/** One app-wide dialog for confirmations and short text input, opened with a promise. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const settledRef = useRef(false);
  const requestRef = useRef<Request | null>(null);

  const show = useCallback((next: Request) => {
    // A dialog opened over another cancels the first, so its caller isn't left waiting.
    const previous = requestRef.current;
    if (previous && !settledRef.current) {
      if (previous.kind === "confirm") previous.resolve(false);
      else previous.resolve(null);
    }
    requestRef.current = next;
    settledRef.current = false;
    setValue(next.kind === "prompt" ? (next.defaultValue ?? "") : "");
    setRequest(next);
    setOpen(true);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => show({ kind: "confirm", resolve, ...options })),
    [show],
  );
  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => show({ kind: "prompt", resolve, ...options })),
    [show],
  );

  const settle = (accepted: boolean) => {
    if (!request || settledRef.current) return;
    settledRef.current = true;
    if (request.kind === "confirm") request.resolve(accepted);
    else request.resolve(accepted && value.trim() ? (request.inputType === "password" ? value : value.trim()) : null);
    setOpen(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (request?.kind === "prompt" && !value.trim()) return;
    settle(true);
  };

  return (
    <DialogsContext.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && settle(false)}>
        {request && (
          <DialogContent showCloseButton={false}>
            <form onSubmit={onSubmit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{request.title}</DialogTitle>
                {request.description ? (
                  <DialogDescription>{request.description}</DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">{request.title}</DialogDescription>
                )}
              </DialogHeader>
              {request.kind === "prompt" && (
                <Input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  type={request.inputType ?? "text"}
                  placeholder={request.placeholder}
                  maxLength={request.maxLength}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => settle(false)}>
                  {(request.kind === "confirm" && request.cancelLabel) || "Cancel"}
                </Button>
                <Button
                  type="submit"
                  autoFocus={request.kind === "confirm"}
                  variant={request.destructive ? "destructive" : "default"}
                  disabled={request.kind === "prompt" && !value.trim()}
                >
                  {request.confirmLabel ?? (request.kind === "confirm" ? "Confirm" : "Save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </DialogsContext.Provider>
  );
}
