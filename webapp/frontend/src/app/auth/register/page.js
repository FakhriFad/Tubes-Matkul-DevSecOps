'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm]     = useState({ full_name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'Name is required';
    if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
    if (form.password.length < 8) e.password = 'Minimum 8 characters';
    if (!/[A-Z]/.test(form.password)) e.password = 'Must include an uppercase letter';
    if (!/[0-9]/.test(form.password)) e.password = 'Must include a number';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      await register(form);
      toast.success('Account created! Please log in.');
      router.push('/auth/login');
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed';
      toast.error(msg);
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
          <p className="text-muted text-sm mt-2">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-5" noValidate>
          <div>
            <label className="label">Full name</label>
            <input
              className="input-field"
              type="text"
              placeholder="Jane Doe"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            {errors.full_name && <p className="text-rust text-xs mt-1">{errors.full_name}</p>}
          </div>

          <div>
            <label className="label">Email</label>
            <input
              className="input-field"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {errors.email && <p className="text-rust text-xs mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="label">Password</label>
            <input
              className="input-field"
              type="password"
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {errors.password && <p className="text-rust text-xs mt-1">{errors.password}</p>}
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
            {loading ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-sm text-muted pt-2">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-ink underline underline-offset-2 hover:text-rust">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
