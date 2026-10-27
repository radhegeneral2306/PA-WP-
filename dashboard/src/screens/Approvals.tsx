import { CalendarCheck } from "@phosphor-icons/react";
import { TopBar } from "../components/ui";

export default function Approvals({ count }: { count: number }) {
  return (
    <div className="lg:max-w-[480px]">
      <TopBar title="Approvals" />
      <div className="flex flex-col items-center px-8 py-16 text-center">
        <CalendarCheck size={40} className="mb-3 text-muted" aria-hidden="true" />
        <p className="text-title font-medium">Jaldi aa raha hai</p>
        <p className="mt-1 max-w-xs text-body text-muted">Staff ki date badalne ki requests yahan approve ya reject hongi.</p>
        <p className="tnum mt-4 rounded-lg bg-surface px-4 py-3 text-body border border-line">
          {count === 0 ? "Abhi koi request pending nahi." : `${count} request pending. Abhi inhe WhatsApp se approve karein.`}
        </p>
      </div>
    </div>
  );
}
