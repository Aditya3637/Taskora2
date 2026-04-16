const plans = [
  {
    name: "Starter",
    price: "₹999",
    period: "/month",
    features: ["Up to 5 users", "10 initiatives", "2 months free trial", "Email support"],
    cta: "Start Free",
    highlight: false,
  },
  {
    name: "Growth",
    price: "₹2,999",
    period: "/month",
    features: ["Up to 25 users", "Unlimited initiatives", "War Room", "Push notifications", "Priority support"],
    cta: "Start Free",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    features: ["Unlimited users", "Custom integrations", "Dedicated support", "SLA"],
    cta: "Contact Sales",
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-[1200px] mx-auto">
        <h2 className="font-display text-4xl font-bold text-midnight text-center mb-4">Simple Pricing</h2>
        <p className="text-steel text-center mb-12">2 months free. No credit card required.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((p) => (
            <div key={p.name} className={`rounded-2xl p-8 border ${p.highlight ? "border-ocean shadow-lg bg-midnight text-white" : "border-pebble bg-white"}`}>
              <h3 className="font-bold text-xl mb-1">{p.name}</h3>
              <div className="text-3xl font-extrabold mb-1">{p.price}<span className="text-sm font-normal">{p.period}</span></div>
              <ul className="space-y-2 my-6">
                {p.features.map((f) => (
                  <li key={f} className={`text-sm flex gap-2 ${p.highlight ? "text-gray-300" : "text-steel"}`}>
                    <span>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button className={`w-full py-3 rounded-lg font-semibold text-sm ${p.highlight ? "bg-taskora-red text-white hover:bg-taskora-red-hover" : "border border-ocean text-ocean hover:bg-mist"}`}>
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
