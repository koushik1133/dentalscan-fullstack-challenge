"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Share2, Sparkles } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import QuickMessageSidebar from "@/components/QuickMessageSidebar";

const VIEW_LABELS = ["Front View", "Left View", "Right View", "Upper Teeth", "Lower Teeth"];

function ResultContent() {
  const router = useRouter();
  const params = useSearchParams();
  const scanId = params.get("scanId") ?? "demo-scan";
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`${scanId}:images`);
      if (raw) setImages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [scanId]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="font-bold text-blue-400 tracking-tight">DentalScan AI</h1>
              <p className="text-[11px] text-zinc-500">Scan {scanId}</p>
            </div>
          </div>
          <NotificationBell userId="clinic-default" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 pb-24 sm:pr-[26rem]">
        {/* Hero */}
        <section className="rounded-2xl bg-gradient-to-br from-blue-600/20 via-emerald-500/10 to-transparent border border-white/5 p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
              <CheckCircle2 className="text-emerald-400" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Scan submitted successfully</h2>
              <p className="text-sm text-zinc-400">
                Your clinic has been notified and is reviewing your scan.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm">
              <Download size={14} /> Download PDF
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm">
              <Share2 size={14} /> Share with dentist
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm">
              <Sparkles size={14} /> View AI analysis
            </button>
          </div>
        </section>

        {/* Gallery */}
        <section className="mb-6">
          <h3 className="text-sm uppercase tracking-widest text-zinc-500 mb-3">
            Captured angles
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {VIEW_LABELS.map((label, i) => (
              <figure
                key={label}
                className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-[3/4] flex flex-col"
              >
                <div className="flex-1 bg-black relative">
                  {images[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={images[i]}
                      alt={label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600">
                      No image
                    </div>
                  )}
                </div>
                <figcaption className="p-2 text-[11px] text-zinc-400 text-center">
                  {label}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Placeholder findings */}
        <section className="rounded-2xl border border-white/5 bg-zinc-950 p-5">
          <h3 className="text-sm uppercase tracking-widest text-zinc-500 mb-3">
            Preliminary findings
          </h3>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              No visible decay detected on anterior teeth.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              Mild plaque build-up near lower molars — dentist will review.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              Bite alignment looks normal in front view.
            </li>
          </ul>
          <p className="text-[11px] text-zinc-600 mt-3">
            This is an AI-assisted preview. Final diagnosis will be delivered by your clinician.
          </p>
        </section>
      </main>

      <QuickMessageSidebar patientId="demo-patient" />
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-zinc-400 flex items-center justify-center">
          Loading…
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
