import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-pebble py-12 px-6">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div>
          <span className="text-midnight font-bold text-lg">Taskora</span>
          <p className="text-steel text-xs mt-1">60-second decision-making platform</p>
        </div>
        <div className="flex gap-6 text-sm text-steel">
          <Link href="/privacy" className="hover:text-midnight">Privacy</Link>
          <Link href="/terms" className="hover:text-midnight">Terms</Link>
          <Link href="/contact" className="hover:text-midnight">Contact</Link>
        </div>
        <p className="text-steel text-xs">© 2026 Taskora. All rights reserved.</p>
      </div>
    </footer>
  );
}
