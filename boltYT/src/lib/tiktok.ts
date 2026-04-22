/**
 * TikTok 업로드 클라이언트 — 로컬 서버(3461)와 통신
 */

function getTikTokServer() {
	if (typeof localStorage !== "undefined") {
		return localStorage.getItem("tiktok_server_url") ?? "http://localhost:3461";
	}
	return "http://localhost:3461";
}

export interface TikTokHealth {
	ok: boolean;
	configured: boolean;
	authenticated: boolean;
}

export interface TikTokAuthStatus {
	authenticated: boolean;
	user?: {
		openId: string;
		displayName: string;
		avatarUrl: string;
	} | null;
}

export interface TikTokUploadResult {
	ok: boolean;
	publishId: string;
}

export async function checkTikTokServer(): Promise<TikTokHealth> {
	try {
		const res = await fetch(`${getTikTokServer()}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		return (await res.json()) as TikTokHealth;
	} catch {
		return { ok: false, configured: false, authenticated: false };
	}
}

export async function getTikTokAuthStatus(): Promise<TikTokAuthStatus> {
	const res = await fetch(`${getTikTokServer()}/auth/status`);
	return (await res.json()) as TikTokAuthStatus;
}

export async function openTikTokAuth(): Promise<void> {
	const res = await fetch(`${getTikTokServer()}/auth/url`);
	const { url } = (await res.json()) as { url: string };
	window.open(url, "_blank", "width=600,height=700");
}

export async function revokeTikTokAuth(): Promise<void> {
	await fetch(`${getTikTokServer()}/auth/revoke`, { method: "POST" });
}

export async function uploadToTikTok(params: {
	filePath: string;
	title: string;
	privacyLevel?:
		| "PUBLIC_TO_EVERYONE"
		| "MUTUAL_FOLLOW_FRIENDS"
		| "FOLLOWER_OF_CREATOR"
		| "SELF_ONLY";
}): Promise<TikTokUploadResult> {
	const res = await fetch(`${getTikTokServer()}/upload`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	if (!res.ok) {
		const err = (await res.json()) as { error?: { message?: string } };
		throw new Error(err.error?.message ?? "TikTok 업로드 실패");
	}
	return (await res.json()) as TikTokUploadResult;
}
