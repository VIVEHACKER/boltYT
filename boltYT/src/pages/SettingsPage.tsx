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
import { getApiProxyUrl } from "../lib/proxy";
import {
	checkYouTubeServer,
	getAuthStatus,
	openAuthPopup,
	revokeAuth,
} from "../lib/youtube";

export default function SettingsPage() {
	const { user } = useAuth();
	const [displayName, setDisplayName] = useState(
		user?.user_metadata?.display_name ?? "로컬 사용자",
	);
	const [message, setMessage] = useState("");
	const [saving, setSaving] = useState(false);

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
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void refreshProxyStatus();
		void refreshYtStatus();
	}, [refreshProxyStatus, refreshYtStatus]);

	async function handleYtConnect() {
		setYtConnecting(true);
		const success = await openAuthPopup();
		setYtConnecting(false);
		if (success) {
			await refreshYtStatus();
			setMessage("YouTube 연동이 완료되었습니다!");
		}
	}

	async function handleYtDisconnect() {
		await revokeAuth();
		setYtAuth({ authenticated: false });
		setMessage("YouTube 연동이 해제되었습니다.");
	}

	function handleSave() {
		setSaving(true);
		localStorage.setItem("display_name", displayName.trim());
		setMessage("설정이 저장되었습니다.");
		setSaving(false);
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
					state="success"
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

			{/* API 프록시 서버 상태 */}
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h2" className="mb-static-md">
					API 프록시 서버
				</PHeading>
				<PText size="small" color="contrast-medium" className="mb-static-lg">
					모든 외부 API 키는 서버에서 관리됩니다. .env 파일에 키를 설정하고
					서버를 실행하세요.
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

					{proxyOk && keysStatus && (
						<div className="flex flex-col gap-static-sm">
							<PText size="small" weight="semi-bold">
								API 키 상태:
							</PText>
							<div className="grid grid-cols-2 gap-static-sm">
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">OpenAI:</PText>
									{renderKeyTag(keysStatus.openai)}
								</div>
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">ElevenLabs:</PText>
									{renderKeyTag(keysStatus.elevenlabs)}
								</div>
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">Pexels:</PText>
									{renderKeyTag(keysStatus.pexels)}
								</div>
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">Pixabay:</PText>
									{renderKeyTag(keysStatus.pixabay)}
								</div>
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">YouTube:</PText>
									{renderKeyTag(keysStatus.youtube)}
								</div>
								<div className="flex items-center gap-static-xs">
									<PText size="x-small">네이버:</PText>
									{renderKeyTag(keysStatus.naver)}
								</div>
							</div>

							<PButton
								variant="secondary"
								compact
								className="mt-static-sm w-fit"
								onClick={refreshProxyStatus}
							>
								새로고침
							</PButton>
						</div>
					)}
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
