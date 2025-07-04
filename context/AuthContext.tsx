import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { Platform, Alert } from 'react-native';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, metadata?: Record<string, any>) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  verifyOtp: (email: string, otp: string) => Promise<{ error: any }>;
  updateProfile: (data: { username?: string, full_name?: string, avatar_url?: string, school?: string }) => Promise<{ error: any }>;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  signUpData: {
    school?: string;
    schoolDomains?: string[];
    email?: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
    password?: string;
  };
  updateSignUpData: (data: Partial<AuthContextType['signUpData']>) => void;
  userProfile: {
    id?: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    school?: string;
  } | null;
  refreshProfile: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signInWithUsername: (username: string, password: string) => Promise<{ error: any }>;
  getInitials: (name: string) => string;
  signInWithSocial: (provider: 'google' | 'microsoft') => Promise<{ error: any }>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updatePassword: (password: string) => Promise<{ error: any }>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  verifyOtp: async () => ({ error: null }),
  updateProfile: async () => ({ error: null }),
  currentStep: 1,
  setCurrentStep: () => {},
  signUpData: {},
  updateSignUpData: () => {},
  userProfile: null,
  refreshProfile: async () => {},
  signInWithGoogle: async () => {},
  signInWithMicrosoft: async () => {},
  signInWithUsername: async () => ({ error: null }),
  getInitials: () => '',
  signInWithSocial: async () => ({ error: null }),
  resetPassword: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [signUpData, setSignUpData] = useState<AuthContextType['signUpData']>({});
  const [userProfile, setUserProfile] = useState<AuthContextType['userProfile']>(null);
  const [profileFetchAttempts, setProfileFetchAttempts] = useState(0);

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Get current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        setSession(currentSession);
        setUser(currentSession?.user || null);

        if (currentSession?.user) {
          await fetchUserProfile(currentSession.user.id);
        }

        // Set up auth state change listener
        const { data: { subscription } } = await supabase.auth.onAuthStateChange(
          async (_event, newSession) => {
            setSession(newSession);
            setUser(newSession?.user || null);

            if (newSession?.user) {
              await fetchUserProfile(newSession.user.id);
            } else {
              setUserProfile(null);
            }
          }
        );

        setLoading(false);
        return () => subscription.unsubscribe();
      } catch (error) {
        console.error('Error initializing auth:', error);
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const fetchUserProfile = async (userId: string) => {
    try {
      // Reset attempts counter if this is a new fetch for a different user
      if (userProfile?.id !== userId) {
        setProfileFetchAttempts(0);
      }

      // Increment attempts counter
      setProfileFetchAttempts(prev => prev + 1);

      console.log(`Fetching user profile for ${userId}, attempt ${profileFetchAttempts + 1}`);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        
        // If we've tried less than 3 times and got a "no rows returned" error,
        // it might be because the profile hasn't been created yet by the trigger
        if (profileFetchAttempts < 3 && error.code === 'PGRST116') {
          console.log('Profile not found, retrying in 1 second...');
          // Wait a second and try again
          setTimeout(() => fetchUserProfile(userId), 1000);
          return;
        }
        
        return;
      }

      console.log('User profile fetched successfully:', data);
      setUserProfile(data);
      // Reset attempts counter on success
      setProfileFetchAttempts(0);
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserProfile(user.id);
    }
  };

  const signUp = async (email: string, password: string, metadata?: Record<string, any>) => {
    try {
      console.log('Starting signup process for:', email);
      console.log('With metadata:', metadata);
      
      // Create the auth user with metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata || {
            full_name: signUpData.fullName || '',
            username: signUpData.username || '',
            school: signUpData.school || '',
          }
        }
      });

      if (authError) {
        console.error('Auth signup error:', authError);
        return { error: authError };
      }

      console.log('Auth user created successfully:', authData.user?.id);

      // Only create the profile if auth signup was successful
      if (authData.user) {
        try {
          // Create profile entry with proper defaults to avoid RLS violations
          console.log('Creating profile for user:', authData.user.id);
          
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: authData.user.id,
              username: metadata?.username || signUpData.username || '',
              full_name: metadata?.full_name || signUpData.fullName || '',
              avatar_url: metadata?.avatar_url || signUpData.avatarUrl || null,
              school: metadata?.school || signUpData.school || '',
            });

          if (profileError) {
            console.error('Error creating profile:', profileError);
            return { error: profileError };
          }
          
          console.log('Profile created successfully');
        } catch (profileError) {
          console.error('Exception creating profile:', profileError);
          return { error: profileError };
        }
      }

      return { error: null };
    } catch (error) {
      console.error('Error in signUp:', error);
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!error) {
        router.replace('/(app)');
      }

      return { error };
    } catch (error) {
      console.error('Error in signIn:', error);
      return { error };
    }
  };

  const signInWithUsername = async (username: string, password: string) => {
    try {
      // First, get the email associated with the username
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .single();

      if (error) {
        return { error: { message: 'Invalid username or password' } };
      }

      // Get the user's email from auth.users
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('email')
        .eq('id', data.id)
        .single();

      if (userError || !userData?.email) {
        return { error: { message: 'Invalid username or password' } };
      }

      // Now sign in with the email and password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userData.email,
        password,
      });

      if (signInError) {
        return { error: signInError };
      }

      router.replace('/(app)');
      return { error: null };
    } catch (error) {
      console.error('Error in signInWithUsername:', error);
      return { error: { message: 'An unexpected error occurred' } };
    }
  };

  const signInWithSocial = async (provider: 'google' | 'microsoft') => {
    try {
      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: window.location.origin,
          },
        });

        return { error };
      } else {
        // For native platforms, we would use a different approach
        // This is simplified for the demo
        return { error: { message: `${provider} sign-in is not supported on this platform yet.` } };
      }
    } catch (error) {
      console.error(`Error signing in with ${provider}:`, error);
      return { error };
    }
  };

  const signInWithGoogle = async () => {
    const { error } = await signInWithSocial('google');
    if (error) {
      Alert.alert('Error', error.message || 'Failed to sign in with Google');
    }
  };

  const signInWithMicrosoft = async () => {
    const { error } = await signInWithSocial('microsoft');
    if (error) {
      Alert.alert('Error', error.message || 'Failed to sign in with Microsoft');
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const verifyOtp = async (email: string, otp: string) => {
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup'
      });
      
      return { error };
    } catch (error) {
      return { error };
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://your-app-url.com/reset-password',
      });
      
      return { error };
    } catch (error) {
      console.error('Error in resetPassword:', error);
      return { error };
    }
  };

  const updatePassword = async (password: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });
      
      return { error };
    } catch (error) {
      console.error('Error in updatePassword:', error);
      return { error };
    }
  };

  const updateProfile = async (data: { username?: string, full_name?: string, avatar_url?: string, school?: string }) => {
    try {
      if (!user) {
        return { error: { message: 'User not authenticated' } };
      }

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          ...data,
          updated_at: new Date().toISOString(),
        });

      if (!error) {
        await refreshProfile();
      }

      return { error };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { error };
    }
  };

  const updateSignUpData = (data: Partial<AuthContextType['signUpData']>) => {
    setSignUpData(prev => ({ ...prev, ...data }));
  };

  const getInitials = (name: string) => {
    if (!name) return '';
    
    return name
      .split(' ')
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        signUp,
        signIn,
        signOut,
        verifyOtp,
        updateProfile,
        currentStep,
        setCurrentStep,
        signUpData,
        updateSignUpData,
        userProfile,
        refreshProfile,
        signInWithGoogle,
        signInWithMicrosoft,
        signInWithUsername,
        getInitials,
        signInWithSocial,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);