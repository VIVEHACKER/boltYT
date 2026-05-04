/**
 * API 키 상태 Context + 훅 (비-컴포넌트). Provider(.tsx) 와 분리해
 * react-refresh/only-export-components 규칙 만족.
 */

import { createContext, useContext } from "react";

export type ApiKeysStatus = {
	openai: boolean;
	elevenlabs: boolean;
	pexels: boolean;
	pixabay: boolean;
	youtube: boolean;
	naver: boolean;
	fal: boolean;
	google: boolean;
	editable?: Record<string, boolean>;
	openaiRuntime?: {
		quotaBlocked: boolean;
		quotaBlockedUntil?: string;
		lastQuotaAt?: string;
		lastQuotaSource?: string;
		lastQuotaError?: string;
		lastOkAt?: string;
	};
};

export const EMPTY_STATUS: ApiKeysStatus = {
	openai: false,
	elevenlabs: false,
	pexels: false,
	pixabay: false,
	youtube: false,
	naver: false,
	fal: false,
	google: false,
};

export interface ApiKeysContextValue {
	status: ApiKeysStatus;
	loaded: boolean;
	error: boolean;
	refresh: () => Promise<void>;
}

export const ApiKeysContext = createContext<ApiKeysContextValue | null>(null);

export function useApiKeys(): ApiKeysContextValue {
	const ctx = useContext(ApiKeysContext);
	if (!ctx) {
		throw new Error("useApiKeys must be used within ApiKeysProvider");
	}
	return ctx;
}

export function useApiKeysStatus(): ApiKeysStatus {
	return useApiKeys().status;
}
