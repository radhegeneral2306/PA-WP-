import { CursorClick } from "@phosphor-icons/react";

export function DetailPlaceholder() {
  return (
    <div className="sticky top-0 flex h-[100dvh] flex-col items-center justify-center border-l border-line px-8 text-center text-muted">
      <CursorClick size={36} aria-hidden="true" />
      <p className="mt-3 text-body">Detail dekhne ke liye koi task chuniye.</p>
    </div>
  );
}
