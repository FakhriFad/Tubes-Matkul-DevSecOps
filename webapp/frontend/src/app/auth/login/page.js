'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [step, setStep]     = useState('credentials'); // 'credentials' | 'mfa'
  const [form, setForm]     = useState({ email: '', password: '' });
  const [totp, setTotp]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleCredentials = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('All fields required'); return; }
    setLoading(true);
    try {
      const result = await login(form.email, form.password);
      if (result.mfa_required) {
        setStep('mfa');
        toast('Enter your authenticator code', { icon: '🔐' });
      } else {
        toast.success('Welcome back!');
        router.push('/items');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    if (totp.length !== 6) { toast.error('Enter the 6-digit code'); return; }
    setLoading(true);
    try {
      await login(form.email, form.password, totp);
      toast.success('Welcome back!');
      router.push('/items');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid MFA code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-md fade-up">
        <div className="text-center mb-10">
          <Link href="/" className="font-display text-3xl text-ink hover:text-rust transition-colors">
            EcomShop
          </Link>
          <p className="text-muted text-sm mt-2">
            {step === 'credentials' ? 'Sign in to your account' : 'Two-factor authentication'}
          </p>
        </div>

        {step === 'credentials' ? (
          <form onSubmit={handleCredentials} className="card space-y-5" noValidate>
            <div>
              <label className="label">Email</label>
              <input
                className="input-field"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoFocus
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                className="input-field"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="text-center text-sm text-muted pt-2">
              No account?{' '}
              <Link href="/auth/register" className="text-ink underline underline-offset-2 hover:text-rust">
                Register
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleMfa} className="card space-y-5">
            <div className="text-center py-2">
              <div className="text-4xl mb-3">🔐</div>
              <p className="text-sm text-muted">
                Open your authenticator app and enter the 6-digit code for <strong>{form.email}</strong>.
              </p>
            </div>

            <div>
              <label className="label">Authenticator code</label>
              <input
                className="input-field text-center font-mono text-xl tracking-[0.4em]"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </div>

            <button type="submit" disabled={loading || totp.length !== 6} className="btn-primary w-full">
              {loading ? 'Verifying…' : 'Verify & Sign in'}
            </button>

            <button
              type="button"
              onClick={() => { setStep('credentials'); setTotp(''); }}
              className="btn-ghost w-full text-center"
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
