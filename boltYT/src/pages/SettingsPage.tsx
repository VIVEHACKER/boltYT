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
import { useApiKeys } from "../lib/api-keys-context";
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
	>({});
	const [keySaving, setKeySaving] = useState(false);

	// API 프록시 서버 상태 (Context가 단일 진실 공급원)
	const { status: keysStatus, refresh } = useApiKeys();
	const [proxyOk, setProxyOk] = useState(false);

	// YouTube 연동 상태
	const [ytServerOk, setYtServerOk] = useState(false);
	const [ytAuth, setYtAuth] = useState<{
		authenticated: boolean;
		channel?: { id: string; title: string; thumbnail: string } | null;
	}>({ authenticated: false });
	const [ytConnecting, setYtConnecting] = useState(false);

	const refreshProxyStatus = useCallback(async () => {
		const proxy = getApiProxyUrl();
		try {
			const healthRes = await fetch(`${proxy}/health`);
			setProxyOk(healthRes.ok);
			if (healthRes.ok) {
				await fetch(`${proxy}/api/keys/reload`, { method: "POST" }).catch(
					() => null,
				);
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

	function handleSave() {
		setSaving(true);
		localStorage.setItem("display_name", displayName.trim());
		saveChannelBranding({
			channelName: brandName,
			channelHandle: brandHandle,
			tagline: brandTagline,
		});
		setMessageState("success");
		setMessage("설정이 저장되었습니다.");
		setSaving(false);
	}

	function handleKeyDraftChange(key: EnvKeyName, value: string) {
		setKeyDrafts((prev) => ({ ...prev, [key]: value }));
	}

	async function handleSaveApiKeys() {
		const keys = Object.fromEntries(
			Object.entries(keyDrafts).filter(([, value]) => value.trim().length > 0),
		);
		if (Object.keys(keys).length === 0) {
			setMessageState("error");
			setMessage("저장할 키를 하나 이상 입력하세요.");
			return;
		}
		setKeySaving(true);
		try {
			const proxy = getApiProxyUrl();
			const res = await fetch(`${proxy}/api/keys/save`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keys }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				updated?: string[];
				error?: string;
			};
			if (!res.ok) {
				throw new Error(data.error ?? `키 저장 실패: ${res.status}`);
			}
			setKeyDrafts({});
			await refreshProxyStatus();
			await refreshYtStatus();
			setMessageState("success");
			setMessage(
				`API 키 ${data.updated?.length ?? Object.keys(keys).length}개를 저장하고 서버에 반영했습니다.`,
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

	function renderKeyTag(configured: boolean) {
		return configured ? (
			<PTag color="notification-success-soft">설정됨</PTag>
		) : (
			<PTag color="notification-warning-soft">미설정</PTag>
		);
	}

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
					여기서 입력한 값은 로컬 `boltYT/.env`에 저장되고 서버에 즉시
					재로드됩니다. 기존 키 값은 보안상 화면에 표시하지 않습니다.
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
							<PTag color="notification-info-soft">저장 위치: boltYT/.env</PTag>
						</div>

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
										{renderKeyTag(Boolean(keysStatus[field.statusKey]))}
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
												keysStatus[field.statusKey]
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
				<PButton loading={saving} onClick={handleSave}>
					설정 저장
				</PButton>
			</div>
		</div>
	);
}
