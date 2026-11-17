import { useEffect, type ReactNode } from "react";
import { IconButton } from "./ui";

/** Centered dialog on desktop; a bottom sheet on phones. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="animate-sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl md:max-h-[90vh] md:max-w-lg md:animate-none md:rounded-2xl dark:bg-neutral-900">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2 md:px-6 md:py-3 dark:border-neutral-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="pb-safe overflow-y-auto overscroll-contain px-4 pt-4 pb-6 md:px-6">{children}</div>
      </div>
    </div>
  );
}
