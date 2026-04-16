import Link from "next/link";

export function HeroSection() {
  return (
    <section className="pt-32 pb-24 px-6 text-center max-w-[1200px] mx-auto">
      <h1 className="font-display text-[56px] leading-[64px] font-extrabold text-midnight mb-6">
        Decisions in 60 Seconds,<br />Not 60 Minutes
      </h1>
      <p className="text-xl text-steel max-w-2xl mx-auto mb-10">
        Taskora replaces meeting rooms with a War Room that surfaces exactly what needs a decision — right now.
      </p>
      <div className="flex gap-4 justify-center">
        <Link href="/signup" className="bg-taskora-red text-white text-lg font-semibold px-8 py-4 rounded-lg hover:bg-taskora-red-hover">
          Start Free for 2 Months
        </Link>
        <button className="text-ocean border border-ocean text-sm font-medium px-6 py-4 rounded-lg hover:bg-mist">
          Watch Demo
        </button>
      </div>
    </section>
  );
}
