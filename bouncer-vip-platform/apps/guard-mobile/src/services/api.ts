// ===========================================
// Guard Mobile App - API Service
// ===========================================

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@env';

const BASE_URL = API_BASE_URL || 'https://api.bouncervip.com';

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
          // Handle logout - emit event or navigate
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
    const { data } = await this.client.post('/auth/login', { email, password });
    if (data.token) {
      await SecureStore.setItemAsync('auth_token', data.token);
    }
    return data;
  }

  async logout() {
    await SecureStore.deleteItemAsync('auth_token');
  }

  async getProfile() {
    const { data } = await this.client.get('/crm/officers/me');
    return data;
  }

  // Shifts
  async getShifts(params?: { date?: string; status?: string }) {
    const { data } = await this.client.get('/scheduling/shifts', { params });
    return data;
  }

  async getShiftById(shiftId: string) {
    const { data } = await this.client.get(`/scheduling/shifts/${shiftId}`);
    return data;
  }

  async checkIn(shiftId: string, coordinates: { lat: number; lng: number }) {
    const { data } = await this.client.post(`/scheduling/shifts/${shiftId}/check-in`, coordinates);
    return data;
  }

  async checkOut(shiftId: string) {
    const { data } = await this.client.post(`/scheduling/shifts/${shiftId}/check-out`);
    return data;
  }

  // Availability
  async getAvailability(date?: string) {
    const { data } = await this.client.get('/scheduling/availability', { params: { date } });
    return data;
  }

  async setAvailability(date: string, slots: { start: string; end: string; available: boolean }[]) {
    const { data } = await this.client.post('/scheduling/availability', { date, slots });
    return data;
  }

  // Incidents
  async getIncidents() {
    const { data } = await this.client.get('/monitoring/incidents');
    return data;
  }

  async reportIncident(incident: {
    shift_id: string;
    venue_id: string;
    incident_type: string;
    severity: string;
    title: string;
    description: string;
    location?: { lat: number; lng: number };
    evidence_images?: string[];
  }) {
    const { data } = await this.client.post('/monitoring/incidents', incident);
    return data;
  }

  // Emergency
  async getEmergencyBookings() {
    const { data } = await this.client.get('/on-demand/bookings');
    return data;
  }

  // Location
  async updateLocation(latitude: number, longitude: number, accuracy: number) {
    const { data } = await this.client.post('/monitoring/locations', {
      officer_id: 'current',
      latitude,
      longitude,
      accuracy,
      timestamp: new Date().toISOString(),
    });
    return data;
  }

  // Venues
  async getVenues() {
    const { data } = await this.client.get('/crm/venues');
    return data;
  }

  async getVenueById(venueId: string) {
    const { data } = await this.client.get(`/crm/venues/${venueId}`);
    return data;
  }

  // Notifications
  async getNotifications() {
    const { data } = await this.client.get('/notifications');
    return data;
  }

  async markNotificationRead(notificationId: string) {
    const { data } = await this.client.patch(`/notifications/${notificationId}/read`);
    return data;
  }
}

export const api = ApiService.getInstance();
export default api;