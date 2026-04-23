// ===========================================
// Admin Web Portal - API Service
// ===========================================

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bouncervip.com';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (email: string, password: string) => 
    api.post('/admin/auth/login', { email, password }),
  logout: () => api.post('/admin/auth/logout'),
  getProfile: () => api.get('/admin/auth/profile'),
};

// Dashboard
export const dashboardApi = {
  getStats: () => api.get('/admin/dashboard/stats'),
  getRevenueChart: (days: number) => api.get(`/admin/dashboard/revenue?days=${days}`),
  getBookingTrends: (days: number) => api.get(`/admin/dashboard/bookings?days=${days}`),
};

// Officers
export const officersApi = {
  list: (params?: any) => api.get('/admin/officers', { params }),
  get: (id: string) => api.get(`/admin/officers/${id}`),
  create: (data: any) => api.post('/admin/officers', data),
  update: (id: string, data: any) => api.put(`/admin/officers/${id}`, data),
  delete: (id: string) => api.delete(`/admin/officers/${id}`),
  assignShift: (officerId: string, shiftId: string) => 
    api.post(`/admin/officers/${officerId}/shifts`, { shiftId }),
};

// Venues
export const venuesApi = {
  list: (params?: any) => api.get('/admin/venues', { params }),
  get: (id: string) => api.get(`/admin/venues/${id}`),
  create: (data: any) => api.post('/admin/venues', data),
  update: (id: string, data: any) => api.put(`/admin/venues/${id}`, data),
  delete: (id: string) => api.delete(`/admin/venues/${id}`),
};

// Bookings
export const bookingsApi = {
  list: (params?: any) => api.get('/admin/bookings', { params }),
  get: (id: string) => api.get(`/admin/bookings/${id}`),
  create: (data: any) => api.post('/admin/bookings', data),
  update: (id: string, data: any) => api.put(`/admin/bookings/${id}`, data),
  cancel: (id: string) => api.post(`/admin/bookings/${id}/cancel`),
  assignOfficers: (bookingId: string, officerIds: string[]) => 
    api.post(`/admin/bookings/${bookingId}/assign`, { officerIds }),
};

// Shifts
export const shiftsApi = {
  list: (params?: any) => api.get('/admin/shifts', { params }),
  get: (id: string) => api.get(`/admin/shifts/${id}`),
  create: (data: any) => api.post('/admin/shifts', data),
  update: (id: string, data: any) => api.put(`/admin/shifts/${id}`, data),
  checkIn: (id: string, data: any) => api.post(`/admin/shifts/${id}/checkin`, data),
  checkOut: (id: string, data: any) => api.post(`/admin/shifts/${id}/checkout`, data),
};

// Incidents
export const incidentsApi = {
  list: (params?: any) => api.get('/admin/incidents', { params }),
  get: (id: string) => api.get(`/admin/incidents/${id}`),
  create: (data: any) => api.post('/admin/incidents', data),
  update: (id: string, data: any) => api.put(`/admin/incidents/${id}`, data),
  resolve: (id: string) => api.post(`/admin/incidents/${id}/resolve`),
};

// Invoices
export const invoicesApi = {
  list: (params?: any) => api.get('/admin/invoices', { params }),
  get: (id: string) => api.get(`/admin/invoices/${id}`),
  create: (data: any) => api.post('/admin/invoices', data),
  send: (id: string) => api.post(`/admin/invoices/${id}/send`),
  markPaid: (id: string) => api.post(`/admin/invoices/${id}/paid`}),
};

// Reports
export const reportsApi = {
  generate: (type: string, params: any) => api.post(`/admin/reports/${type}`, params),
  download: (reportId: string) => api.get(`/admin/reports/${reportId}/download`),
  list: () => api.get('/admin/reports'),
};

// Settings
export const settingsApi = {
  get: () => api.get('/admin/settings'),
  update: (data: any) => api.put('/admin/settings', data),
};

// Notifications
export const notificationsApi = {
  list: () => api.get('/admin/notifications'),
  markRead: (id: string) => api.patch(`/admin/notifications/${id}/read`),
  markAllRead: () => api.patch('/admin/notifications/read-all'),
};

export default api;