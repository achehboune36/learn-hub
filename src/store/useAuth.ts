/**
 * Auth state.
 *
 * With Firebase configured: Google sign-in, session persisted by the SDK.
 * Without it: a stable "local:<id>" identity so the app is fully usable offline
 * and before the Firebase project exists. Progress written locally is not
 * migrated on sign-in — that is deliberate, to avoid silently merging two
 * histories.
 */
import { create } from 'zustand';
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signOut as fbSignOut, onAuthStateChanged,
} from 'firebase/auth';
import { auth, firebaseEnabled } from '../lib/firebase';

export interface Account {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  isLocal: boolean;
}

interface AuthState {
  account: Account | null;
  ready: boolean;
  error: string | null;
  init: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  useLocalAccount: () => void;
}

const LOCAL_KEY = 'learnhub.localUid';

function localAccount(): Account {
  let uid = localStorage.getItem(LOCAL_KEY);
  if (!uid) {
    uid = `local:${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(LOCAL_KEY, uid);
  }
  return { uid, displayName: 'Local learner', email: null, photoURL: null, isLocal: true };
}

export const useAuth = create<AuthState>((set) => ({
  account: null,
  ready: false,
  error: null,

  init: () => {
    if (!firebaseEnabled || !auth) {
      // No Firebase project yet — fall straight through to local mode.
      set({ account: localAccount(), ready: true });
      return;
    }
    onAuthStateChanged(auth, (user) => {
      set({
        account: user
          ? {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              photoURL: user.photoURL,
              isLocal: false,
            }
          : null,
        ready: true,
      });
    });
  },

  signIn: async () => {
    if (!auth) return;
    set({ error: null });
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // Popups are blocked in some browsers/embedded views; redirect always works.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
        return;
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      set({ error: (e as Error).message });
    }
  },

  signOut: async () => {
    if (auth) await fbSignOut(auth);
    set({ account: null });
  },

  useLocalAccount: () => set({ account: localAccount(), ready: true }),
}));
