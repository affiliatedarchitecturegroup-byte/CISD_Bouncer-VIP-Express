// ===========================================
// Client Portal - API Service
// ===========================================

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bouncervip.com';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('client_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const authApi = {
  login: (email: string, password: string) => 
    api.post('/client/auth/login', { email, password }),
  register: (data: any) => api.post('/client/auth/register', data),
  logout: () => api.post('/client/auth/logout'),
};

// Dashboard
export const dashboardApi = {
  getStats: () => api.get('/client/dashboard/stats'),
};

// Bookings
export const bookingsApi = {
  list: (params?: any) => api.get('/client/bookings', { params }),
  get: (id: string) => api.get(`/client/bookings/${id}`),
  create: (data: any) => api.post('/client/bookings', data),
  cancel: (id: string) => api.post(`/client/bookings/${id}/cancel`),
};

// Invoices
export const invoicesApi = {
  list: (params?: any) => api.get('/client/invoices', { params }),
  get: (id: string) => api.get(`/client/invoices/${id}`),
  pay: (id: string, method: string) => api.post(`/client/invoices/${id}/pay`, { method }),
};

// Incidents
export const incidentsApi = {
  list: () => api.get('/client/incidents'),
  get: (id: string) => api.get(`/client/incidents/${id}`),
  report: (data: any) => api.post('/client/incidents', data),
};

// Venues
export const venuesApi = {
  list: () => api.get('/client/venues'),
  get: (id: string) => api.get(`/client/venues/${id}`),
};

export default api;