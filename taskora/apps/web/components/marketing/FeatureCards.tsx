const features = [
  {
    icon: "⚡",
    title: "60-Second War Room",
    desc: "Surface the most critical decisions first. No noise, no distractions — just what needs to happen now.",
  },
  {
    icon: "🏗️",
    title: "Initiative Rollout",
    desc: "Roll out a single initiative across hundreds of buildings or clients simultaneously, with per-entity status tracking.",
  },
  {
    icon: "📊",
    title: "Daily Brief",
    desc: "Every morning, your team sees exactly what's overdue, blocked, or pending a decision.",
  },
  {
    icon: "🔔",
    title: "Push Notifications",
    desc: "Delegates, approvals, and escalations land in real time. No email chains, no WhatsApp groups.",
  },
];

export function FeatureCards() {
  return (
    <section className="py-20 px-6 bg-mist">
      <div className="max-w-[1200px] mx-auto">
        <h2 className="font-display text-4xl font-bold text-midnight text-center mb-12">
          Why Taskora?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div key={f.title} className="bg-white rounded-2xl p-6 shadow-sm border border-pebble">
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-midnight text-lg mb-2">{f.title}</h3>
              <p className="text-steel text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
