/**
 * Instagram Reels 업로드 클라이언트 — 로컬 서버(3462)와 통신
 */

function getIgServer() {
	if (typeof localStorage !== "undefined") {
		return (
			localStorage.getItem("instagram_server_url") ?? "http://localhost:3462"
		);
	}
	return "http://localhost:3462";
}

export interface IgHealth {
	ok: boolean;
	configured: boolean;
	authenticated: boolean;
}

export interface IgAuthStatus {
	authenticated: boolean;
	user?: {
		igUserId: string;
		username: string;
	} | null;
}

export interface IgUploadResult {
	ok: boolean;
	mediaId: string;
}

export async function checkInstagramServer(): Promise<IgHealth> {
	try {
		const res = await fetch(`${getIgServer()}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		return (await res.json()) as IgHealth;
	} catch {
		return { ok: false, configured: false, authenticated: false };
	}
}

export async function getIgAuthStatus(): Promise<IgAuthStatus> {
	const res = await fetch(`${getIgServer()}/auth/status`);
	return (await res.json()) as IgAuthStatus;
}

export async function openIgAuth(): Promise<void> {
	const res = await fetch(`${getIgServer()}/auth/url`);
	const { url } = (await res.json()) as { url: string };
	window.open(url, "_blank", "width=600,height=700");
}

export async function revokeIgAuth(): Promise<void> {
	await fetch(`${getIgServer()}/auth/revoke`, { method: "POST" });
}

export async function uploadToInstagram(params: {
	videoUrl: string;
	caption: string;
	coverUrl?: string;
}): Promise<IgUploadResult> {
	const res = await fetch(`${getIgServer()}/upload`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	if (!res.ok) {
		const err = (await res.json()) as { error?: { message?: string } };
		throw new Error(err.error?.message ?? "Instagram 업로드 실패");
	}
	return (await res.json()) as IgUploadResult;
}
