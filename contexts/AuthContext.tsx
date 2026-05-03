import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authAPI } from '../services/api';

interface User {
  id: string;
  oderId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  wallet?: {
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
  };
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredUser();
  }, []);

  const loadStoredUser = async () => {
    try {
      // Restore the saved session on app launch so the user stays logged
      // in across app exit / reopen. The token is a 7-day JWT (see
      // server signToken); if it's expired or revoked, the request
      // interceptor in services/api.ts clears it and forces re-login on
      // the next API call.
      const [storedToken, storedUser] = await Promise.all([
        SecureStore.getItemAsync('authToken'),
        SecureStore.getItemAsync('user'),
      ]);
      if (storedToken && storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          if (parsed && parsed._id) {
            setUser(parsed);
            // Fire-and-forget refresh of the profile so any server-side
            // changes (perms, balance, KYC status) show on this launch.
            // Failure here doesn't kick the user out — the 401 path in
            // the api interceptor handles auth invalidation centrally.
            authAPI.getProfile()
              .then((res) => {
                if (res.data?.user) {
                  setUser(res.data.user);
                  SecureStore.setItemAsync('user', JSON.stringify(res.data.user)).catch(() => {});
                }
              })
              .catch(() => { /* leave cached user in place */ });
          } else {
            setUser(null);
          }
        } catch {
          // Corrupt stored payload — clear and force re-login.
          await Promise.all([
            SecureStore.deleteItemAsync('user'),
            SecureStore.deleteItemAsync('authToken'),
          ]);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Error loading stored user:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);
      const response = await authAPI.login(username, password);
      
      if (response.data?.success && response.data?.token) {
        const { token, user: userData } = response.data;
        
        await SecureStore.setItemAsync('authToken', token);
        await SecureStore.setItemAsync('user', JSON.stringify(userData));
        
        setUser(userData);
        return { success: true };
      }
      
      return { success: false, error: response.data?.error || 'Login failed' };
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Login failed';
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      await SecureStore.deleteItemAsync('user');
      await SecureStore.deleteItemAsync('authToken');
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const response = await authAPI.getProfile();
      if (response.data?.user) {
        setUser(response.data.user);
        await SecureStore.setItemAsync('user', JSON.stringify(response.data.user));
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
