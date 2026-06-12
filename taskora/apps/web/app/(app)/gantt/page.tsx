"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ProgramTimeline from "./ProgramTimeline";

function GanttPageInner() {
  const searchParams = useSearchParams();
  const programScope = searchParams.get("program");

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        {programScope && (
          <a href="/gantt"
            className="inline-flex items-center gap-1 text-xs text-steel hover:text-midnight mb-1 transition-colors">
            ← All programs
          </a>
        )}
        <h1 className="text-2xl font-bold text-midnight">Program Timeline</h1>
        <p className="text-steel text-sm mt-1">
          Plan the year across programs, initiatives, and their tasks.
        </p>
      </div>
      <ProgramTimeline programScope={programScope} />
    </div>
  );
}

export default function GanttPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    }>
      <GanttPageInner />
    </Suspense>
  );
}
