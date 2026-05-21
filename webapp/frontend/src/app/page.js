import Link from 'next/link';
import Navbar from '../components/Navbar';

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-cream">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 fade-up">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <p className="label mb-4">New arrivals</p>
              <h1 className="text-6xl md:text-7xl font-display text-ink leading-none mb-6">
                Shop<br />
                <em className="not-italic text-rust">without</em><br />
                limits.
              </h1>
              <p className="text-muted text-lg mb-10 max-w-sm leading-relaxed">
                Curated products, transparent pricing, and a checkout experience that respects your time.
              </p>
              <div className="flex items-center gap-4">
                <Link href="/items" className="btn-primary text-base px-8 py-4">
                  Browse Shop
                </Link>
                <Link href="/auth/register" className="btn-ghost text-base">
                  Create account →
                </Link>
              </div>
            </div>

            {/* Abstract decoration */}
            <div className="hidden md:block relative h-96">
              <div className="absolute top-0 right-0 w-72 h-72 bg-gold/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-8 w-48 h-48 bg-rust/15 rounded-full blur-2xl" />
              <div className="relative z-10 h-full flex items-center justify-center">
                <div className="grid grid-cols-2 gap-4">
                  {['Free shipping', 'Secure checkout', 'Easy returns', '24/7 support'].map((t) => (
                    <div key={t} className="card text-center py-8 px-4 hover:-translate-y-1 transition-transform duration-200">
                      <p className="text-sm font-medium text-ink">{t}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features strip */}
        <section className="border-t border-border bg-white">
          <div className="max-w-6xl mx-auto px-6 py-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 stagger">
              {[
                { icon: '🔒', title: 'HTTPS + MFA', desc: 'Bank-grade security on every account' },
                { icon: '⚡', title: 'Redis Cache', desc: 'Sub-millisecond catalogue reads' },
                { icon: '📋', title: 'Audit Logs', desc: 'Every action is traced and stored' },
                { icon: '🛡️', title: 'RBAC', desc: 'Role-based access at every endpoint' },
              ].map((f) => (
                <div key={f.title} className="text-center">
                  <div className="text-3xl mb-3">{f.icon}</div>
                  <p className="font-medium text-ink text-sm mb-1">{f.title}</p>
                  <p className="text-xs text-muted">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
