/**
 * BgmSourcePanel — 곡별 BGM 소스 선택/생성/가져오기.
 *
 * 타임라인 에디터에서 이 영상의 BGM을 직접 정한다:
 *  - AI 생성: Stable Audio 2.5(fal.ai)로 주제 무드에 맞는 고유 인스트루멘탈 생성(claim-free).
 *  - 외부 트랙 가져오기: BGM 라이브러리에서 받은 파일 import + 라이선스/Content ID claim 기록.
 * 설정한 BGM은 timeline-store의 project.bgmUrl로 반영된다(MixerPanel과 동일한 패턴).
 */

import { type CSSProperties, useState } from "react";
import {
	BGM_MOODS,
	type BgmMood,
	type BgmSourceMode,
	getBgmSourceMode,
	setBgmFromFile,
	setBgmFromUrl,
	setBgmSourceMode,
} from "../../lib/bgm";
import { generateBgmTrack } from "../../lib/bgm-ai-generation";
import {
	assessImportedBgmClaimReadiness,
	type BgmLicense,
	PAID_BGM_LIBRARIES,
	type PaidBgmLibrary,
} from "../../lib/bgm-import";
import { useTimelineStore } from "../../lib/timeline-store";

const PAID_LIBRARY_IDS = Object.keys(PAID_BGM_LIBRARIES) as PaidBgmLibrary[];

export function BgmSourcePanel({ scriptId }: { scriptId: string }) {
	const project = useTimelineStore((s) => s.project);
	const setBgmUrl = useTimelineStore((s) => s.setBgmUrl);
	const snapshot = useTimelineStore((s) => s.snapshot);

	const [mode, setMode] = useState<BgmSourceMode>(() => getBgmSourceMode());
	const [mood, setMood] = useState<BgmMood>("calm");
	const [durationSeconds, setDurationSeconds] = useState(60);
	const [library, setLibrary] = useState<PaidBgmLibrary>("epidemic_sound");
	const [clearCode, setClearCode] = useState("");
	const [channelCleared, setChannelCleared] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [messageOk, setMessageOk] = useState(true);

	if (!project) {
		return (
			<div style={{ padding: 16, color: "#777", fontSize: 12 }}>
				프로젝트가 없습니다.
			</div>
		);
	}

	const libraryInfo = PAID_BGM_LIBRARIES[library];

	function applyBgm(url: string) {
		// useTimelineLoad는 bgm_url_<scriptId>에서 복원하므로 같은 키에 저장해야
		// 새로고침/재진입 후에도 선택한 BGM이 유지된다.
		try {
			localStorage.setItem(`bgm_url_${scriptId}`, url);
		} catch {
			/* localStorage 불가 환경 무시 */
		}
		snapshot();
		setBgmUrl(url);
	}

	function report(ok: boolean, text: string) {
		setMessageOk(ok);
		setMessage(text);
	}

	async function handleGenerate() {
		setBusy(true);
		report(true, "AI BGM 생성 중… (수십 초 소요)");
		try {
			const { audioUrl } = await generateBgmTrack(mood, { durationSeconds });
			const localUrl = await setBgmFromUrl(audioUrl, scriptId);
			applyBgm(localUrl);
			report(true, "AI BGM 생성 완료 — 타임라인에 반영했습니다.");
		} catch (e) {
			report(
				false,
				`생성 실패: ${e instanceof Error ? e.message : "알 수 없음"}`,
			);
		} finally {
			setBusy(false);
		}
	}

	async function handleImport(file: File | undefined) {
		if (!file) return;
		setBusy(true);
		report(true, "트랙 가져오는 중…");
		try {
			const localUrl = await setBgmFromFile(file, scriptId);
			const claimExpected = libraryInfo.claimClearMethod !== "claim_free";
			const license: BgmLicense = {
				basis: "licensed",
				library,
				contentId: {
					claimExpected,
					clearMethod: libraryInfo.claimClearMethod,
					clearCode: clearCode.trim() || undefined,
					channelCleared,
				},
			};
			const readiness = assessImportedBgmClaimReadiness(license);
			try {
				localStorage.setItem(
					`bgm_license_${scriptId}`,
					JSON.stringify(license),
				);
			} catch {
				/* localStorage 불가 환경 무시 */
			}
			applyBgm(localUrl);
			if (readiness.cleared) {
				report(true, "가져오기 완료 — Content ID claim 준비됨.");
			} else {
				report(
					false,
					`가져왔으나 claim 미해결: ${readiness.blockers.join(" / ")}`,
				);
			}
		} catch (e) {
			report(
				false,
				`가져오기 실패: ${e instanceof Error ? e.message : "알 수 없음"}`,
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			style={{
				padding: 12,
				background: "#0a0a0a",
				borderTop: "1px solid #2a2a2a",
				color: "rgba(255,255,255,0.85)",
				fontSize: 12,
				display: "flex",
				flexDirection: "column",
				gap: 10,
			}}
		>
			<div style={{ fontWeight: 700, letterSpacing: "0.05em" }}>BGM 소스</div>

			{/* 소스 모드 토글 (자동 선택 시 적용) */}
			<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
				<span style={{ color: "rgba(255,255,255,0.55)" }}>자동 선택:</span>
				{(["library", "ai"] as BgmSourceMode[]).map((m) => (
					<button
						key={m}
						type="button"
						onClick={() => {
							setBgmSourceMode(m);
							setMode(m);
						}}
						aria-pressed={mode === m}
						style={pillStyle(mode === m)}
					>
						{m === "library" ? "라이브러리" : "AI 생성"}
					</button>
				))}
			</div>

			{/* AI 생성 */}
			<div style={cardStyle}>
				<div style={cardTitleStyle}>AI 생성 (Stable Audio)</div>
				<div
					style={{
						display: "flex",
						gap: 6,
						flexWrap: "wrap",
						alignItems: "center",
					}}
				>
					<select
						value={mood}
						onChange={(e) => setMood(e.target.value as BgmMood)}
						style={inputStyle}
						aria-label="BGM 무드"
					>
						{BGM_MOODS.map((m) => (
							<option key={m.id} value={m.id}>
								{m.emoji} {m.label}
							</option>
						))}
					</select>
					<input
						type="number"
						min={10}
						max={190}
						value={durationSeconds}
						onChange={(e) => setDurationSeconds(Number(e.target.value))}
						style={{ ...inputStyle, width: 64 }}
						aria-label="BGM 길이(초)"
					/>
					<span style={{ color: "rgba(255,255,255,0.45)" }}>초</span>
					<button
						type="button"
						onClick={handleGenerate}
						disabled={busy}
						style={actionStyle(busy)}
					>
						생성
					</button>
				</div>
				<div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>
					고유 인스트루멘탈 · Content ID claim 없음 · FAL_KEY 필요
				</div>
			</div>

			{/* 외부 트랙 가져오기 */}
			<div style={cardStyle}>
				<div style={cardTitleStyle}>외부 BGM 가져오기</div>
				<div
					style={{
						display: "flex",
						gap: 6,
						flexWrap: "wrap",
						alignItems: "center",
					}}
				>
					<select
						value={library}
						onChange={(e) => setLibrary(e.target.value as PaidBgmLibrary)}
						style={inputStyle}
						aria-label="BGM 라이브러리"
					>
						{PAID_LIBRARY_IDS.map((id) => (
							<option key={id} value={id}>
								{PAID_BGM_LIBRARIES[id].label}
							</option>
						))}
					</select>
					{libraryInfo.claimClearMethod === "per_video_code" && (
						<input
							type="text"
							placeholder="claim 코드"
							value={clearCode}
							onChange={(e) => setClearCode(e.target.value)}
							style={{ ...inputStyle, width: 110 }}
							aria-label="claim 클리어 코드"
						/>
					)}
					{(libraryInfo.claimClearMethod === "channel_safelist" ||
						libraryInfo.claimClearMethod === "channel_clearlist") && (
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: 4,
								fontSize: 11,
							}}
						>
							<input
								type="checkbox"
								checked={channelCleared}
								onChange={(e) => setChannelCleared(e.target.checked)}
							/>
							채널 등록 완료
						</label>
					)}
					<label style={actionStyle(busy)}>
						파일 선택
						<input
							type="file"
							accept="audio/*"
							disabled={busy}
							onChange={(e) => {
								const file = e.target.files?.[0];
								// 같은 파일 재선택 시에도 onChange가 다시 발화하도록 초기화
								e.target.value = "";
								handleImport(file);
							}}
							style={{ display: "none" }}
						/>
					</label>
				</div>
				<div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>
					{libraryInfo.downloadUrl
						? `받는 곳: ${libraryInfo.downloadUrl} · ${libraryInfo.notes}`
						: libraryInfo.notes}
				</div>
			</div>

			{message && (
				<div
					style={{
						fontSize: 11,
						color: messageOk ? "#86efac" : "#fca5a5",
					}}
				>
					{message}
				</div>
			)}
		</div>
	);
}

const cardStyle: CSSProperties = {
	background: "#121212",
	border: "1px solid #2a2a2a",
	borderRadius: 6,
	padding: 10,
	display: "flex",
	flexDirection: "column",
	gap: 6,
};

const cardTitleStyle: CSSProperties = {
	fontSize: 11,
	fontWeight: 700,
	color: "rgba(255,255,255,0.7)",
	textTransform: "uppercase",
	letterSpacing: "0.04em",
};

const inputStyle: CSSProperties = {
	background: "#1a1a1a",
	color: "rgba(255,255,255,0.85)",
	border: "1px solid #2a2a2a",
	borderRadius: 4,
	padding: "4px 6px",
	fontSize: 11,
};

function pillStyle(active: boolean): CSSProperties {
	return {
		fontSize: 11,
		fontWeight: 600,
		padding: "3px 10px",
		borderRadius: 4,
		border: "none",
		cursor: "pointer",
		background: active ? "rgba(99,102,241,0.3)" : "#1a1a1a",
		color: active ? "#c7d2fe" : "rgba(255,255,255,0.55)",
	};
}

function actionStyle(disabled: boolean): CSSProperties {
	return {
		fontSize: 11,
		fontWeight: 600,
		padding: "5px 12px",
		borderRadius: 4,
		border: "none",
		cursor: disabled ? "not-allowed" : "pointer",
		background: disabled ? "#1a1a1a" : "rgba(16,185,129,0.28)",
		color: disabled ? "rgba(255,255,255,0.35)" : "#6ee7b7",
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
	};
}
