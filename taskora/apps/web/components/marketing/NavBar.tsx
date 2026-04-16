import Link from "next/link";

export function NavBar() {
  return (
    <nav className="fixed top-0 w-full bg-white border-b border-pebble z-50">
      <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-midnight font-bold text-xl">Taskora</Link>
        <div className="hidden md:flex gap-8 text-sm font-medium text-steel">
          <Link href="/features" className="hover:text-midnight">Features</Link>
          <Link href="/pricing" className="hover:text-midnight">Pricing</Link>
          <Link href="/use-cases" className="hover:text-midnight">Use Cases</Link>
          <Link href="/blog" className="hover:text-midnight">Blog</Link>
        </div>
        <div className="flex gap-3">
          <Link href="/login" className="text-ocean text-sm font-medium px-4 py-2 border border-ocean rounded-lg hover:bg-mist">Login</Link>
          <Link href="/signup" className="bg-taskora-red text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-taskora-red-hover">Start Free for 2 Months</Link>
        </div>
      </div>
    </nav>
  );
}
