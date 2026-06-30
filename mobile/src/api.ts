import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';

const api = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'sales';
  hasFaceEnrolled?: boolean;
  phone?: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: User; token: string }>('/auth/login', { email, password }),
  register: (data: { email: string; password: string; name: string; role?: string }) =>
    api.post('/auth/register', data),
  me: () => api.get<User & { hasFaceEnrolled: boolean }>('/auth/me'),
  enrollFace: (photoUri: string) => {
    const form = new FormData();
    form.append('photo', { uri: photoUri, type: 'image/jpeg', name: 'face.jpg' } as any);
    return api.post('/auth/enroll-face', form);
  },
};

export const adminApi = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: () => api.get('/admin/users'),
  createUser: (data: any) => api.post('/admin/users', data),
  getLocations: () => api.get('/admin/locations'),
  createLocation: (data: any) => api.post('/admin/locations', data),
  updateLocation: (id: string, data: any) => api.put(`/admin/locations/${id}`, data),
  getAttendance: () => api.get('/admin/attendance'),
  getForms: () => api.get('/forms/admin'),
  createForm: (data: any) => api.post('/forms/admin', data),
  getFormSubmissions: (id: string) => api.get(`/forms/admin/${id}/submissions`),
};

export const salesApi = {
  getLocations: () => api.get('/sales/locations'),
  checkIn: (locationId: string, lat: number, lng: number, photoUri: string) => {
    const form = new FormData();
    form.append('location_id', locationId);
    form.append('latitude', String(lat));
    form.append('longitude', String(lng));
    form.append('photo', { uri: photoUri, type: 'image/jpeg', name: 'face.jpg' } as any);
    return api.post('/sales/attendance/check-in', form, { timeout: 60000 });
  },
  getTodayAttendance: () => api.get('/sales/attendance/today'),
  getPendingFollowUp: () => api.get('/sales/attendance/pending-followup'),
  submitFollowUp: (id: string, lat: number, lng: number) =>
    api.post(`/sales/attendance/${id}/follow-up`, { latitude: lat, longitude: lng }),
  getForms: () => api.get('/forms/sales'),
  submitForm: (id: string, data: any) => api.post(`/forms/sales/${id}/submit`, { data }),
  getMySubmissions: () => api.get('/forms/sales/my-submissions'),
};

export const leadsApi = {
  getAll: () => api.get('/leads'),
  create: (data: any) => api.post('/leads', data),
  update: (id: string, data: any) => api.put(`/leads/${id}`, data),
  delete: (id: string) => api.delete(`/leads/${id}`),
  getFunnel: () => api.get('/leads/funnel'),
};

export default api;
