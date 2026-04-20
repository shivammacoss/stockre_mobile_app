import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL } from '../config';

// Identifies the APK in server activity logs so admin's "Activity Logs" page
// shows mobile-originated logins/trades with device=mobile + a real OS string.
const APP_VERSION = '1.0.0';
const CLIENT_UA = `StocktreMobile/${APP_VERSION} (${Platform.OS} ${Platform.Version}; Mobile)`;

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'X-Client': 'mobile-app',
    'X-Client-Platform': Platform.OS,
    'X-Client-Version': APP_VERSION,
    // axios on RN ignores `User-Agent` on iOS/Android, so we send it on a
    // custom header too — server reads either.
    'X-Client-UA': CLIENT_UA,
  },
});

// Request interceptor — add auth token
api.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('authToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('authToken');
      await SecureStore.deleteItemAsync('user');
    }
    return Promise.reject(error);
  }
);

// ═══ Auth ═══
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/api/auth/login', { username, password }),
  register: (data: object) =>
    api.post('/api/auth/register', data),
  logout: () => api.post('/api/auth/logout'),
  getProfile: () => api.get('/api/auth/profile'),
  getEmailConfig: () => api.get('/api/auth/email-config'),
  sendSignupOtp: (email: string) => api.post('/api/auth/send-signup-otp', { email }),
  forgotPassword: (email: string) => api.post('/api/auth/forgot-password', { email }),
  resetPassword: (data: { email: string; otp: string; newPassword: string; confirmPassword: string }) =>
    api.post('/api/auth/reset-password', data),
  updateProfile: (data: { email?: string; phone?: string; city?: string; state?: string }) =>
    api.put('/api/auth/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api.put('/api/auth/change-password', data),
};

// ═══ Bank Accounts ═══
export const bankAPI = {
  list: (userId: string) => api.get(`/api/user/bank-accounts/${userId}`),
  add: (userId: string, data: { bankName: string; accountNumber: string; ifsc: string; accountHolder: string; upiId?: string }) =>
    api.post(`/api/user/bank-accounts/${userId}`, data),
  remove: (userId: string, bankId: string) =>
    api.delete(`/api/user/bank-accounts/${userId}/${bankId}`),
};

// ═══ KYC ═══
export const kycAPI = {
  getStatus: (userId: string) => api.get(`/api/kyc/status/${userId}`),
  submit: (data: {
    userId: string;
    oderId?: string;
    documentType: 'aadhaar' | 'pan' | 'passport';
    documentNumber: string;
    frontImage?: string;
    backImage?: string;
    selfieImage?: string;
    fullName?: string;
    dateOfBirth?: string;
    address?: string;
  }) => api.post('/api/kyc/submit', data),
};

// ═══ Trading ═══ (matches server/index.js endpoints)
export const tradingAPI = {
  getAllPositions: (userId: string) =>
    api.get(`/api/positions/all/${userId}`),

  getPositions: (userId: string, mode: string = 'netting') =>
    api.get(`/api/positions/${mode}/${userId}`),

  getTradeHistory: (userId: string) =>
    api.get(`/api/trades/${userId}`),

  getPendingOrders: (userId: string) =>
    api.get(`/api/orders/pending/${userId}`),

  getCancelledOrders: (userId: string) =>
    api.get(`/api/orders/cancelled/${userId}`),

  // Place order — matches POST /api/orders
  placeOrder: (data: {
    userId: string;
    symbol: string;
    side: string;
    volume: number;
    orderType?: string;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    mode?: string;
    exchange?: string;
    segment?: string;
    lotSize?: number;
    session?: string;
    marketData?: { bid: number; ask: number };
    spreadPreApplied?: boolean;
  }) => api.post('/api/orders', data),

  // Alias for backward compat
  openTrade: (data: any) => api.post('/api/orders', data),

  // Close position — matches POST /api/positions/close
  closePosition: (data: {
    userId: string;
    symbol: string;
    volume?: number;
    mode?: string;
    currentPrice?: number;
    positionId?: string;
  }) => api.post('/api/positions/close', data),

  // Alias
  closeTrade: (data: any) => api.post('/api/positions/close', data),

  // Cancel order
  cancelOrder: (data: { orderId: string; userId: string; mode?: string }) =>
    api.post('/api/orders/cancel', data),

  // Close single leg (netting)
  closePositionLeg: (data: { userId: string; tradeId: string; currentPrice: number; closeReason?: string }) =>
    api.post('/api/positions/close-leg', data),

  // Modify SL/TP on a position
  modifyPosition: (data: { userId: string; symbol: string; positionId?: string; stopLoss?: number; takeProfit?: number; mode?: string }) =>
    api.post('/api/positions/modify', data),

  // Cancel pending order (alias)
  cancelPendingOrder: (data: { userId: string; orderId: string; mode?: string }) =>
    api.post('/api/orders/cancel', data),

  // Netting entries — individual trade legs for a parent position
  getTradeLegs: (userId: string, orderId: string) =>
    api.get(`/api/trades/legs/${userId}/${encodeURIComponent(orderId)}`),

  // Netting entries for a history group row (a specific close action)
  getTradeGroup: (userId: string, groupId: string) =>
    api.get(`/api/trades/group/${userId}/${encodeURIComponent(groupId)}`),

  // Update per-leg SL/TP (netting mode, active legs only)
  updateTradeLeg: (tradeId: string, data: { userId: string; stopLoss: number | null; takeProfit: number | null }) =>
    api.put(`/api/trades/legs/${tradeId}`, data),
};

// ═══ Wallet ═══
export const walletAPI = {
  getWallet: (userId: string) => api.get(`/api/wallet/${userId}`),
  getUserWallet: (userId: string) => api.get(`/api/user/wallet/${userId}`),
  getTransactions: (userId: string) => api.get(`/api/transactions/${userId}`),
  getExchangeRate: () => api.get('/api/exchange-rate'),
  submitTransaction: (data: object) => api.post('/api/transactions', data),
  getPaymentMethods: (userId?: string) =>
    api.get(userId ? `/api/admin-payment-details/for-user/${userId}` : '/api/admin-payment-details'),
  getSavedBankAccounts: (userId: string) => api.get(`/api/user/bank-accounts/${userId}`),
  getEligibleBonus: (userId: string, amount: number) =>
    api.get(`/api/user/eligible-bonus?userId=${encodeURIComponent(userId)}&amount=${amount}`),
};

// ═══ Instruments ═══
export const instrumentsAPI = {
  // MetaAPI instruments (forex, stocks, indices, commodities)
  getInstruments: () => api.get('/api/instruments'),

  // Delta Exchange instruments (crypto)
  getDeltaInstruments: () => api.get('/api/delta/instruments'),

  // Zerodha subscribed instruments (Indian)
  getZerodhaInstruments: () => api.get('/api/zerodha/instruments/subscribed'),

  // Zerodha status
  getZerodhaStatus: () => api.get('/api/zerodha/status'),

  // Zerodha LTP
  getZerodhaLTP: () => api.get('/api/zerodha/ltp'),

  // Zerodha instrument search (for Indian NSE/BSE/MCX segments)
  searchZerodha: (query: string, segment: string) =>
    api.get(`/api/zerodha/instruments/search?query=${encodeURIComponent(query)}&segment=${segment}`),

  // Subscribe a Zerodha instrument (adds to server subscribed list so ticks flow)
  subscribeZerodhaInstrument: (instrument: any) =>
    api.post('/api/zerodha/instruments/subscribe', { instrument }),

  // Unsubscribe a Zerodha instrument by token
  unsubscribeZerodhaInstrument: (token: number | string) =>
    api.delete(`/api/zerodha/instruments/subscribe/${token}`),

  // Option chain — NSE | BSE | MCX | CRYPTO (server normalizes case).
  // Returns { expiries, expiry, strikes: [{ strike, ce, pe }] }.
  getOptionsChain: (params: { segment: string; underlying: string; expiry?: string }) =>
    api.get('/api/options-chain', { params }),
};

// ═══ User ═══
export const userAPI = {
  getProfile: () => api.get('/api/user/profile'),
  updateProfile: (data: object) => api.put('/api/user/profile', data),
  getPreferences: () => api.get('/api/user/preferences'),
  updatePreferences: (data: object) => api.put('/api/user/preferences', data),
  getUserInstruments: (userId: string) => api.get(`/api/user/instruments/${userId}`),
  getUserDetails: (userId: string) => api.get(`/api/admin/users/${userId}`),
  getSegmentSettings: (symbol: string, userId?: string) =>
    api.get(`/api/user/segment-settings/by-symbol/${symbol}${userId ? `?userId=${userId}` : ''}`),
  getAllSegmentSettings: (userId?: string) =>
    api.get(`/api/user/all-segment-settings${userId ? `?userId=${userId}` : ''}`),
  getTradeModesSettings: () => api.get('/api/settings/trade-modes'),
};

// ═══ IB ═══
export const ibAPI = {
  getProfile: () => api.get('/api/ib/profile'),
  apply: (data: object) => api.post('/api/ib/apply', data),
  getDashboard: () => api.get('/api/ib/dashboard'),
  getReferrals: (limit = 20) => api.get(`/api/ib/referrals?limit=${limit}`),
  getCommissions: (limit = 20) => api.get(`/api/ib/commissions?limit=${limit}`),
  withdraw: (amount: number) => api.post('/api/ib/withdraw', { amount }),
};

// ═══ Banners (home page carousel, admin-controlled) ═══
export const bannerAPI = {
  getActive: () => api.get('/api/banners/active'),
};

// ═══ Notifications ═══
export const notificationAPI = {
  getNotifications: (userId: string) => api.get(`/api/user/notifications/${userId}`),
  markAsRead: (notifId: string, userId: string) => api.post(`/api/user/notifications/${notifId}/read`, { userId }),
  markAllRead: (userId: string) => api.post(`/api/user/notifications/${userId}/read-all`),
  getUnreadCount: (userId: string) => api.get(`/api/user/notifications/${userId}/unread-count`),
};

export default api;
