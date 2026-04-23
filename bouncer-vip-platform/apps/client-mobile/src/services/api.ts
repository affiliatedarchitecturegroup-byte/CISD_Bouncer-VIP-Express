// ===========================================
// Client Mobile App - API Service
// ===========================================

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.bouncervip.com';

class ApiService {
  private client: AxiosInstance;
  private static instance: ApiService;

  private constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use(async (config) => {
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          await SecureStore.deleteItemAsync('auth_token');
        }
        return Promise.reject(error);
      }
    );
  }

  static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  // Auth
  async login(email: string, password: string) {
    const { data } = await this.client.post('/client/auth/login', { email, password });
    if (data.token) {
      await SecureStore.setItemAsync('auth_token', data.token);
      await SecureStore.setItemAsync('user_id', data.user_id);
    }
    return data;
  }

  async logout() {
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('user_id');
  }

  async register(userData: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    company?: string;
    phone?: string;
  }) {
    const { data } = await this.client.post('/client/auth/register', userData);
    return data;
  }

  async getProfile() {
    const { data } = await this.client.get('/client/profile');
    return data;
  }

  async updateProfile(updates: any) {
    const { data } = await this.client.put('/client/profile', updates);
    return data;
  }

  // Dashboard
  async getDashboardStats() {
    const { data } = await this.client.get('/client/dashboard/stats');
    return data;
  }

  // Bookings
  async getBookings(params?: { status?: string; from?: string; to?: string }) {
    const { data } = await this.client.get('/client/bookings', { params });
    return data;
  }

  async getBookingById(bookingId: string) {
    const { data } = await this.client.get(`/client/bookings/${bookingId}`);
    return data;
  }

  async createBooking(booking: {
    venueId: string;
    serviceType: string;
    requestedDate: string;
    startTime: string;
    endTime: string;
    officerCount: number;
    specialInstructions?: string;
  }) {
    const { data } = await this.client.post('/client/bookings', booking);
    return data;
  }

  async cancelBooking(bookingId: string) {
    const { data } = await this.client.post(`/client/bookings/${bookingId}/cancel`);
    return data;
  }

  // Venues
  async getVenues() {
    const { data } = await this.client.get('/client/venues');
    return data;
  }

  async getVenueById(venueId: string) {
    const { data } = await this.client.get(`/client/venues/${venueId}`);
    return data;
  }

  // Invoices
  async getInvoices(params?: { status?: string; from?: string; to?: string }) {
    const { data } = await this.client.get('/client/invoices', { params });
    return data;
  }

  async getInvoiceById(invoiceId: string) {
    const { data } = await this.client.get(`/client/invoices/${invoiceId}`);
    return data;
  }

  async payInvoice(invoiceId: string, paymentMethod: string) {
    const { data } = await this.client.post(`/client/invoices/${invoiceId}/pay`, { method: paymentMethod });
    return data;
  }

  // Incidents
  async getIncidents() {
    const { data } = await this.client.get('/client/incidents');
    return data;
  }

  async getIncidentById(incidentId: string) {
    const { data } = await this.client.get(`/client/incidents/${incidentId}`);
    return data;
  }

  async reportIncident(incident: {
    title: string;
    description: string;
    severity: string;
    location?: string;
  }) {
    const { data } = await this.client.post('/client/incidents', incident);
    return data;
  }

  // Notifications
  async getNotifications() {
    const { data } = await this.client.get('/client/notifications');
    return data;
  }

  async markNotificationRead(notificationId: string) {
    const { data } = await this.client.patch(`/client/notifications/${notificationId}/read`);
    return data;
  }

  // Locations
  async getLocations() {
    const { data } = await this.client.get('/client/locations');
    return data;
  }

  async addLocation(location: {
    name: string;
    address: string;
    city: string;
    province: string;
    latitude: number;
    longitude: number;
    capacity: number;
  }) {
    const { data } = await this.client.post('/client/locations', location);
    return data;
  }
}

export const api = ApiService.getInstance();
export default api;