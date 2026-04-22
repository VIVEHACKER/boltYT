import type { Session, User } from "@supabase/supabase-js";
import { useEffect } from "react";
import { create } from "zustand";
import { DEMO_MODE, supabase } from "../lib/supabase";

interface AuthState {
	session: Session | null;
	user: User | null;
	loading: boolean;
	setSession: (session: Session | null) => void;
	setLoading: (loading: boolean) => void;
}

const DEMO_USER = {
	id: "demo-user",
	email: "demo@example.com",
	app_metadata: {},
	user_metadata: { display_name: "데모 사용자" },
	aud: "authenticated",
	created_at: "2026-04-01T00:00:00Z",
} as unknown as User;

const DEMO_SESSION = {
	user: DEMO_USER,
	expires_in: 99999,
	token_type: "bearer",
} as unknown as Session;

export const useAuthStore = create<AuthState>((set) => ({
	session: DEMO_MODE ? DEMO_SESSION : null,
	user: DEMO_MODE ? DEMO_USER : null,
	loading: !DEMO_MODE,
	setSession: (session) => set({ session, user: session?.user ?? null }),
	setLoading: (loading) => set({ loading }),
}));

export function useAuth() {
	const { session, user, loading, setSession, setLoading } = useAuthStore();

	useEffect(() => {
		if (DEMO_MODE) return;

		supabase.auth
			.getSession()
			.then(
				({ data: { session: s } }: { data: { session: Session | null } }) => {
					setSession(s);
					setLoading(false);
				},
			);

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event: string, s: Session | null) => {
			setSession(s);
			setLoading(false);
		});

		return () => subscription.unsubscribe();
	}, [setSession, setLoading]);

	return { session, user, loading };
}
