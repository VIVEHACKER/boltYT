import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PInputText,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { type ApiKeysStatus, useApiKeys } from "../lib/api-keys-context";
import { loadChannelBranding, saveChannelBranding } from "../lib/channel-branding";
import { getApiProxyUrl } from "../lib/proxy";
import {
	checkYouTubeServer,
	getAuthStatus,
	openAuthPopup,
	revokeAuth,
} from "../lib/youtube";

type EnvKeyName =
	| "OPENAI_API_KEY"
	| "ELEVENLABS_API_KEY"
	| "PEXELS_API_KEY"
	| "PIXABAY_API_KEY"
	| "YOUTUBE_API_KEY"
	| "NAVER_CLIENT_ID"
	| "NAVER_CLIENT_SECRET"
	| "FAL_KEY"
	| "GOOGLE_CLIENT_ID"
	| "GOOGLE_CLIENT_SECRET";

const API_KEY_FIELDS: Array<{
	key: EnvKeyName;
	label: string;
	description: string;
	statusKey:
		| "openai"
		| "elevenlabs"
		| "pexels"
		| "pixabay"
		| "youtube"
		| "naver"
		| "fal"
		| "google";
}> = [
	{
		key: "OPENAI_API_KEY",
		label: "OpenAI API Key",
		description: "전사, Vision 분석, 스크립트/이미지 생성에 사용됩니다.",
		statusKey: "openai",
	},
	{
		key: "YOUTUBE_API_KEY",
		label: "YouTube Data API Key",
		description: "채널/영상 검색과 레퍼런스 자동 수집에 사용됩니다.",
		statusKey: "youtube",
	},
	{
		key: "GOOGLE_CLIENT_ID",
		label: "Google OAuth Client ID",
		description: "YouTube 업로드 OAuth 연결에 사용됩니다.",
		statusKey: "google",
	},
	{
		key: "GOOGLE_CLIENT_SECRET",
		label: "Google OAuth Client Secret",
		description: "YouTube 업로드 OAuth 연결에 사용됩니다.",
		statusKey: "google",
	},
	{
		key: "ELEVENLABS_API_KEY",
		label: "ElevenLabs API Key",
		description: "고품질 TTS 음성 생성에 사용됩니다.",
		statusKey: "elevenlabs",
	},
	{
		key: "PEXELS_API_KEY",
		label: "Pexels API Key",
		description: "자료 이미지/영상 검색에 사용됩니다.",
		statusKey: "pexels",
	},
	{
		key: "PIXABAY_API_KEY",
		label: "Pixabay API Key",
		description: "대체 자료 이미지/영상 검색에 사용됩니다.",
		statusKey: "pixabay",
	},
	{
		key: "NAVER_CLIENT_ID",
		label: "Naver Client ID",
		description: "한국어 이미지/뉴스 검색에 사용됩니다.",
		statusKey: "naver",
	},
	{
		key: "NAVER_CLIENT_SECRET",
		label: "Naver Client Secret",
		description: "한국어 이미지/뉴스 검색에 사용됩니다.",
		statusKey: "naver",
	},
	{
		key: "FAL_KEY",
		label: "fal.ai Key",
		description: "외부 이미지/영상 생성 provider에 사용됩니다.",
		statusKey: "fal",
	},
];

const API_KEY_DRAFT_STORAGE_KEY = "settings_api_key_drafts_v1";
const API_KEY_STATUS_CACHE_KEY = "settings_api_key_status_cache_v1";
const API_KEY_FIELD_SET = new Set<EnvKeyName>(
	API_KEY_FIELDS.map((field) => field.key),
);

function sanitizedKeyDrafts(value: unknown): Partial<Record<EnvKeyName, string>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const drafts: Partial<Record<EnvKeyName, string>> = {};
	for (const [key, draft] of Object.entries(value)) {
		if (!API_KEY_FIELD_SET.has(key as EnvKeyName) || typeof draft !== "string") {
			continue;
		}
		if (draft.trim()) drafts[key as EnvKeyName] = draft;
	}
	return drafts;
}

function loadKeyDraftsFromSession(): Partial<Record<EnvKeyName, string>> {
	if (typeof sessionStorage === "undefined") return {};
	try {
		const raw = sessionStorage.getItem(API_KEY_DRAFT_STORAGE_KEY);
		return raw ? sanitizedKeyDrafts(JSON.parse(raw)) : {};
	} catch {
		return {};
	}
}

function saveKeyDraftsToSession(drafts: Partial<Record<EnvKeyName, string>>) {
	if (typeof sessionStorage === "undefined") return;
	const sanitized = sanitizedKeyDrafts(drafts);
	if (Object.keys(sanitized).length === 0) {
		sessionStorage.removeItem(API_KEY_DRAFT_STORAGE_KEY);
		return;
	}
	sessionStorage.setItem(API_KEY_DRAFT_STORAGE_KEY, JSON.stringify(sanitized));
}

function sanitizeStatus(value: unknown): ApiKeysStatus | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Partial<ApiKeysStatus>;
	return {
		openai: raw.openai === true,
		elevenlabs: raw.elevenlabs === true,
		pexels: raw.pexels === true,
		pixabay: raw.pixabay === true,
		youtube: raw.youtube === true,
		naver: raw.naver === true,
		fal: raw.fal === true,
		google: raw.google === true,
		editable:
			raw.editable && typeof raw.editable === "object"
				? Object.fromEntries(
						Object.entries(raw.editable).map(([key, configured]) => [
							key,
							configured === true,
						]),
					)
				: undefined,
		openaiRuntime: raw.openaiRuntime,
	};
}

function hasConfiguredStatus(status?: ApiKeysStatus | null): boolean {
	if (!status) return false;
	return API_KEY_FIELDS.some((field) =>
		Boolean(status.editable?.[field.key] ?? status[field.statusKey]),
	);
}

function loadLastKnownKeysStatus(): ApiKeysStatus | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(API_KEY_STATUS_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { status?: unknown };
		return sanitizeStatus(parsed.status);
	} catch {
		return null;
	}
}

function saveLastKnownKeysStatus(status: ApiKeysStatus) {
	if (typeof localStorage === "undefined" || !hasConfiguredStatus(status)) return;
	localStorage.setItem(
		API_KEY_STATUS_CACHE_KEY,
		JSON.stringify({ savedAt: new Date().toISOString(), status }),
	);
}

export default function SettingsPage() {
	const { user } = useAuth();
	const [displayName, setDisplayName] = useState(
		user?.user_metadata?.display_name ?? "로컬 사용자",
	);
	const [brandName, setBrandName] = useState(
		() => loadChannelBranding().channelName,
	);
	const [brandHandle, setBrandHandle] = useState(
		() => loadChannelBranding().channelHandle,
	);
	const [brandTagline, setBrandTagline] = useState(
		() => loadChannelBranding().tagline,
	);
	const [message, setMessage] = useState("");
	const [messageState, setMessageState] = useState<"success" | "error">("success");
	const [saving, setSaving] = useState(false);
	const [keyDrafts, setKeyDrafts] = useState<
		Partial<Record<EnvKeyName, string>>
	>(() => loadKeyDraftsFromSession());
	const [keySaving, setKeySaving] = useState(false);
	const [savedKeysStatus, setSavedKeysStatus] = useState<ApiKeysStatus | null>(
		null,
	);
	const [lastKnownKeysStatus, setLastKnownKeysStatus] =
		useState<ApiKeysStatus | null>(() => loadLastKnownKeysStatus());

	// API 프록시 서버 상태 (Context가 단일 진실 공급원)
	const { status: keysStatus, error: keysStatusError, refresh } = useApiKeys();
	const [proxyOk, setProxyOk] = useState(false);
	const usingLastKnownKeysStatus =
		!savedKeysStatus && !proxyOk && Boolean(lastKnownKeysStatus);
	const displayedKeysStatus: ApiKeysStatus =
		savedKeysStatus ??
		(keysStatusError && lastKnownKeysStatus
			? lastKnownKeysStatus
			: usingLastKnownKeysStatus && lastKnownKeysStatus
				? lastKnownKeysStatus
				: keysStatus);
	const hasUnsavedKeyDrafts = Object.values(keyDrafts).some((value) =>
		Boolean(value?.trim()),
	);

	// YouTube 연동 상태
	const [ytServerOk, setYtServerOk] = useState(false);
	const [ytAuth, setYtAuth] = useState<{
		authenticated: boolean;
		channel?: { id: string; title: string; thumbnail: string } | null;
	}>({ authenticated: false });
	const [ytConnecting, setYtConnecting] = useState(false);

	const refreshProxyStatus = useCallback(async () => {
		setSavedKeysStatus(null);
		const proxy = getApiProxyUrl();
		try {
			const healthRes = await fetch(`${proxy}/health`);
			setProxyOk(healthRes.ok);
			if (healthRes.ok) {
				await fetch(`${proxy}/api/keys/reload`, { method: "POST" }).catch(
					() => null,
				);
				const statusRes = await fetch(`${proxy}/api/keys/status`);
				if (statusRes.ok) {
					const status = sanitizeStatus(await statusRes.json());
					if (status) {
						setSavedKeysStatus(status);
						setLastKnownKeysStatus(status);
						saveLastKnownKeysStatus(status);
					}
				}
			}
		} catch {
			setProxyOk(false);
		}
		// 키 상태는 Context가 관리 — 여기서 수동 새로고침만 트리거
		await refresh();
	}, [refresh]);

	const refreshYtStatus = useCallback(async () => {
		const health = await checkYouTubeServer();
		setYtServerOk(health.ok && health.configured);
		if (health.ok && health.configured) {
			const status = await getAuthStatus();
			setYtAuth(status);
		}
	}, []);

	useEffect(() => {
		void refreshProxyStatus();
		void refreshYtStatus();
	}, [refreshProxyStatus, refreshYtStatus]);

	useEffect(() => {
		if (!hasConfiguredStatus(keysStatus)) return;
		setLastKnownKeysStatus(keysStatus);
		saveLastKnownKeysStatus(keysStatus);
	}, [keysStatus]);

	useEffect(() => {
		if (!hasUnsavedKeyDrafts) return;
		function handleBeforeUnload(event: BeforeUnloadEvent) {
			event.preventDefault();
		}
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [hasUnsavedKeyDrafts]);

	async function handleYtConnect() {
		setYtConnecting(true);
		const success = await openAuthPopup();
		setYtConnecting(false);
		if (success) {
			await refreshYtStatus();
			setMessageState("success");
			setMessage("YouTube 연동이 완료되었습니다!");
		}
	}

	async function handleYtDisconnect() {
		await revokeAuth();
		setYtAuth({ authenticated: false });
		setMessageState("success");
		setMessage("YouTube 연동이 해제되었습니다.");
	}

	function handleKeyDraftChange(key: EnvKeyName, value: string) {
		setKeyDrafts((prev) => {
			const next = sanitizedKeyDrafts({ ...prev, [key]: value });
			saveKeyDraftsToSession(next);
			return next;
		});
	}

	function collectApiKeyDrafts() {
		return Object.fromEntries(
			Object.entries(keyDrafts).filter(([, value]) => value.trim().length > 0),
		) as Record<string, string>;
	}

	async function persistApiKeyDrafts(keys: Record<string, string>) {
		const proxy = getApiProxyUrl();
		const res = await fetch(`${proxy}/api/keys/save`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ keys }),
		});
		const data = (await res.json().catch(() => ({}))) as {
			updated?: string[];
			status?: ApiKeysStatus;
			error?: string;
		};
		if (!res.ok) {
			throw new Error(data.error ?? `키 저장 실패: ${res.status}`);
		}
		setKeyDrafts({});
		saveKeyDraftsToSession({});
		if (data.status) {
			setSavedKeysStatus(data.status);
			setLastKnownKeysStatus(data.status);
			saveLastKnownKeysStatus(data.status);
		}
		await refreshProxyStatus();
		await refreshYtStatus();
		return data.updated?.length ?? Object.keys(keys).length;
	}

	async function handleSave() {
		setSaving(true);
		const keys = collectApiKeyDrafts();
		if (Object.keys(keys).length > 0) setKeySaving(true);
		try {
			localStorage.setItem("display_name", displayName.trim());
			saveChannelBranding({
				channelName: brandName,
				channelHandle: brandHandle,
				tagline: brandTagline,
			});
			const savedKeyCount =
				Object.keys(keys).length > 0 ? await persistApiKeyDrafts(keys) : 0;
			setMessageState("success");
			setMessage(
				savedKeyCount > 0
					? `설정과 API 키 ${savedKeyCount}개를 저장하고 서버에 반영했습니다.`
					: "설정이 저장되었습니다.",
			);
		} catch (error) {
			setMessageState("error");
			setMessage(
				error instanceof Error ? error.message : "설정 저장 중 오류가 발생했습니다.",
			);
		} finally {
			setSaving(false);
			setKeySaving(false);
		}
	}

	async function handleSaveApiKeys() {
		const keys = collectApiKeyDrafts();
		if (Object.keys(keys).length === 0) {
			setMessageState("error");
			setMessage("저장할 키를 하나 이상 입력하세요.");
			return;
		}
		setKeySaving(true);
		try {
			const savedKeyCount = await persistApiKeyDrafts(keys);
			setMessageState("success");
			setMessage(
				`API 키 ${savedKeyCount}개를 저장하고 서버에 반영했습니다.`,
			);
		} catch (error) {
			setMessageState("error");
			setMessage(
				error instanceof Error
					? error.message
					: "API 키 저장 중 오류가 발생했습니다.",
			);
		} finally {
			setKeySaving(false);
		}
	}

	function isFieldConfigured(field: (typeof API_KEY_FIELDS)[number]) {
		return Boolean(
			displayedKeysStatus.editable?.[field.key] ??
				displayedKeysStatus[field.statusKey],
		);
	}

	function renderKeyTag(field: (typeof API_KEY_FIELDS)[number]) {
		const configured = isFieldConfigured(field);
		if (
			field.key === "OPENAI_API_KEY" &&
			configured &&
			displayedKeysStatus.openaiRuntime?.quotaBlocked
		) {
			return <PTag color="notification-error-soft">쿼터 차단</PTag>;
		}
		return configured ? (
			<PTag
				color={
					usingLastKnownKeysStatus
						? "notification-warning-soft"
						: "notification-success-soft"
				}
			>
				{usingLastKnownKeysStatus ? "최근 저장됨" : "설정됨"}
			</PTag>
		) : (
			<PTag color="notification-warning-soft">미설정</PTag>
		);
	}

	const openAiRuntime = displayedKeysStatus.openaiRuntime;
	const openAiQuotaBlocked = Boolean(
		displayedKeysStatus.openai && openAiRuntime?.quotaBlocked,
	);
	const openAiQuotaRetryAt = openAiRuntime?.quotaBlockedUntil
		? new Date(openAiRuntime.quotaBlockedUntil).toLocaleString()
		: "";

	return (
		<div className="max-w-2xl">
			<PHeading size="x-large" tag="h1" className="mb-static-sm">
				설정
			</PHeading>
			<PText color="contrast-medium" className="mb-fluid-md">
				로컬 환경 설정을 관리하세요.
			</PText>

			{message && (
				<PInlineNotification
					state={messageState}
					className="mb-static-md"
					dismissButton={false}
				>
					{message}
				</PInlineNotification>
			)}

			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h2" className="mb-static-lg">
					프로필
				</PHeading>
				<div className="flex flex-col gap-static-lg">
					<PInputText
						name="displayName"
						label="이름"
						value={displayName}
						onInput={(e) =>
							setDisplayName((e.target as HTMLInputElement).value)
						}
					/>
					<PInputText
						name="email"
						label="이메일"
						value={user?.email ?? "local@boltyt.local"}
						readOnly
					/>
				</div>
			</div>

			<PDivider className="my-fluid-md" />

			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h2" className="mb-static-md">
					렌더 브랜딩
				</PHeading>
				<PText size="small" color="contrast-medium" className="mb-static-lg">
					쇼츠 카드, 썸네일, 업로드 메타데이터에 기본으로 넣을 채널 표기를
					설정합니다.
				</PText>
				<div className="flex flex-col gap-static-lg">
					<PInputText
						name="brandName"
						label="영상에 표시할 채널명"
						value={brandName}
						onInput={(e) => setBrandName((e.target as HTMLInputElement).value)}
					/>
					<PInputText
						name="brandHandle"
						label="채널 핸들"
						description="@ 없이 입력해도 저장 시 자동으로 붙습니다."
						value={brandHandle}
						onInput={(e) => setBrandHandle((e.target as HTMLInputElement).value)}
					/>
					<PInputText
						name="brandTagline"
						label="짧은 브랜드 문구"
						value={brandTagline}
						onInput={(e) =>
							setBrandTagline((e.target as HTMLInputElement).value)
						}
					/>
				</div>
			</div>

			<PDivider className="my-fluid-md" />

			{/* API 프록시 서버 상태 */}
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h2" className="mb-static-md">
					API 프록시 서버
				</PHeading>
					<PText size="small" color="contrast-medium" className="mb-static-lg">
						여기서 입력한 값은 Vite가 감시하지 않는 로컬 런타임 키 저장소에
						저장되고 서버에 즉시 재로드됩니다. 기존 키 값은 보안상 화면에
						표시하지 않습니다.
				</PText>

				<div className="flex flex-col gap-static-md">
					<div className="flex items-center gap-static-sm">
						<PText size="small" weight="semi-bold">
							서버 상태:
						</PText>
						{proxyOk ? (
							<PTag color="notification-success-soft">연결됨</PTag>
						) : (
							<PTag color="notification-error-soft">미연결</PTag>
						)}
					</div>

						{!proxyOk && (
							<PInlineNotification state="warning" dismissButton={false}>
								API 프록시 서버가 실행 중이지 않습니다. 터미널에서 실행하세요: npm
								run servers
							</PInlineNotification>
						)}

						{!proxyOk && hasConfiguredStatus(lastKnownKeysStatus) && (
							<PInlineNotification state="info" dismissButton={false}>
								저장된 키 값이 지워진 것은 아닙니다. 현재는 API 프록시가 꺼져
								실시간 검증을 못 해서 마지막 저장 상태를 표시합니다.
							</PInlineNotification>
						)}

						{openAiQuotaBlocked && (
							<PInlineNotification state="warning" dismissButton={false}>
								OpenAI 키는 저장되어 있지만 현재 계정 quota/billing 오류가 감지되어
								전사와 Vision 호출을 자동 우회 중입니다.
								{openAiQuotaRetryAt ? ` 재시도 예정: ${openAiQuotaRetryAt}` : ""}
							</PInlineNotification>
						)}

					<div className="rounded-[8px] bg-base p-static-md">
						<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-static-sm mb-static-md">
							<div>
								<PText size="small" weight="semi-bold">
									API 키 입력
								</PText>
								<PText size="x-small" color="contrast-medium">
									저장할 키만 붙여넣으세요. 빈 칸은 기존 값을 유지합니다.
								</PText>
							</div>
								<PTag color="notification-info-soft">저장 위치: 로컬 키 저장소</PTag>
							</div>

							{hasUnsavedKeyDrafts && (
								<PInlineNotification
									state="warning"
									dismissButton={false}
									className="mb-static-md"
								>
									입력 중인 API 키가 아직 로컬 키 저장소에 저장되지 않았습니다.
									현재 탭에서만 임시 보존 중이며, 저장 성공 후 자동으로 비웁니다.
								</PInlineNotification>
							)}

							<div className="grid grid-cols-1 gap-static-md">
							{API_KEY_FIELDS.map((field) => (
								<div
									key={field.key}
									className="rounded-[8px] bg-surface p-static-sm"
								>
									<div className="mb-static-xs flex items-center justify-between gap-static-sm">
											<PText size="small" weight="semi-bold">
												{field.label}
											</PText>
											{renderKeyTag(field)}
										</div>
									<label className="block">
										<span className="mb-static-xs block text-xs font-semibold text-contrast-medium">
											{field.key}
										</span>
										<input
											name={field.key}
											type="password"
											autoComplete="off"
											placeholder={
												isFieldConfigured(field)
													? "새 값으로 교체할 때만 입력"
													: "키를 붙여넣기"
											}
											value={keyDrafts[field.key] ?? ""}
											disabled={!proxyOk || keySaving}
											onChange={(e) =>
												handleKeyDraftChange(field.key, e.target.value)
											}
											className="w-full rounded-[6px] border border-contrast-low bg-base px-static-sm py-static-xs text-sm text-contrast-high outline-none transition focus:border-contrast-high disabled:cursor-not-allowed disabled:opacity-60"
										/>
										<span className="mt-static-xs block text-xs text-contrast-medium">
											{field.description}
										</span>
									</label>
								</div>
							))}
						</div>

						<div className="mt-static-md flex flex-wrap gap-static-sm">
							<PButton
								compact
								loading={keySaving}
								disabled={!proxyOk || keySaving}
								onClick={handleSaveApiKeys}
							>
								입력한 키 저장
							</PButton>
							<PButton
								variant="secondary"
								compact
								disabled={!proxyOk || keySaving}
								onClick={refreshProxyStatus}
							>
								상태 새로고침
							</PButton>
						</div>
					</div>
				</div>
			</div>

			<PDivider className="my-fluid-md" />

			{/* YouTube 연동 */}
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h2" className="mb-static-md">
					YouTube 연동
				</PHeading>
				<PText size="small" color="contrast-medium" className="mb-static-lg">
					영상 업로드, 예약 발행, 분석 데이터 동기화에 사용됩니다.
				</PText>

				<div className="flex flex-col gap-static-md">
					<div className="flex items-center gap-static-sm">
						<PText size="small" weight="semi-bold">
							업로드 서버:
						</PText>
						{ytServerOk ? (
							<PTag color="notification-success-soft">연결됨</PTag>
						) : (
							<PTag color="notification-error-soft">미연결</PTag>
						)}
					</div>

					{!ytServerOk && (
						<PInlineNotification state="warning" dismissButton={false}>
							YouTube 서버가 실행 중이지 않습니다. 터미널에서 실행하세요: npx
							tsx server/youtube-upload.ts
						</PInlineNotification>
					)}

					{ytServerOk && (
						<>
							<div className="flex items-center gap-static-sm">
								<PText size="small" weight="semi-bold">
									YouTube 계정:
								</PText>
								{ytAuth.authenticated ? (
									<div className="flex items-center gap-static-sm">
										{ytAuth.channel?.thumbnail && (
											<img
												src={ytAuth.channel.thumbnail}
												alt=""
												className="w-6 h-6 rounded-full"
											/>
										)}
										<PText size="small">
											{ytAuth.channel?.title ?? "연결됨"}
										</PText>
										<PTag color="notification-success-soft">인증됨</PTag>
									</div>
								) : (
									<PTag color="notification-warning-soft">미연결</PTag>
								)}
							</div>

							{ytAuth.authenticated ? (
								<PButton
									variant="secondary"
									compact
									onClick={handleYtDisconnect}
								>
									연동 해제
								</PButton>
							) : (
								<PButton
									compact
									loading={ytConnecting}
									onClick={handleYtConnect}
								>
									YouTube 계정 연결
								</PButton>
							)}
						</>
					)}
				</div>
			</div>

				<div className="mt-fluid-md">
					<PButton loading={saving} disabled={saving || keySaving} onClick={handleSave}>
						설정 저장
					</PButton>
				</div>
		</div>
	);
}
