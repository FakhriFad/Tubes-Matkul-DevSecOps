import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://localhost/api',
  timeout: 10000,
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global 401 handler – clear token and redirect
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      Cookies.remove('token');
      Cookies.remove('user');
      if (typeof window !== 'undefined') window.location.href = '/auth/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login:    (data) => api.post('/auth/login', data),
  logout:   ()     => api.post('/auth/logout'),
  me:       ()     => api.get('/auth/me'),
  mfaSetup:   ()       => api.post('/auth/mfa/setup'),
  mfaVerify:  (totp)   => api.post('/auth/mfa/verify', { totp }),
  mfaDisable: (totp)   => api.post('/auth/mfa/disable', { totp }),
};

// ── Items ─────────────────────────────────────────────────────────────────────
export const itemsApi = {
  list:   ()       => api.get('/items'),
  get:    (id)     => api.get(`/items/${id}`),
  create: (data)   => api.post('/items', data),
  update: (id, d)  => api.put(`/items/${id}`, d),
  remove: (id)     => api.delete(`/items/${id}`),
};

// ── Cart ──────────────────────────────────────────────────────────────────────
export const cartApi = {
  get:        ()              => api.get('/cart'),
  addItem:    (item_id, qty)  => api.post('/cart/items', { item_id, quantity: qty }),
  updateItem: (id, qty)       => api.patch(`/cart/items/${id}`, { quantity: qty }),
  removeItem: (id)            => api.delete(`/cart/items/${id}`),
  checkout:   ()              => api.post('/cart/checkout'),
};
