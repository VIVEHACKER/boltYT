import {
	PButton,
	PHeading,
	PText,
} from "@porsche-design-system/components-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
	/** 자동 복구 최대 시도 횟수 (기본 2) */
	maxAutoRecover?: number;
}

interface State {
	hasError: boolean;
	error: Error | null;
	autoRecoverAttempts: number;
	recovering: boolean;
}

const AUTO_RECOVER_DELAY = 1500;

export class ErrorBoundary extends Component<Props, State> {
	private recoverTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(props: Props) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
			autoRecoverAttempts: 0,
			recovering: false,
		};
	}

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[ErrorBoundary]", error, info.componentStack);

		// 모듈 import 실패 → 브라우저 캐시 문제 → 자동 하드 리로드 (1회만)
		if (this.needsHardReload(error)) {
			const reloadKey = "eb_hard_reload";
			const lastReload = sessionStorage.getItem(reloadKey);
			const now = Date.now();
			// 10초 이내 연속 리로드 방지 (무한 루프 차단)
			if (!lastReload || now - Number(lastReload) > 10_000) {
				sessionStorage.setItem(reloadKey, String(now));
				console.warn(
					"[ErrorBoundary] Module import failed — hard reloading...",
				);
				window.location.reload();
				return;
			}
			// 10초 이내 재발이면 리로드 포기 → fallback UI 표시
		}

		const maxAttempts = this.props.maxAutoRecover ?? 2;

		// 자동 복구 가능한 에러인지 판단
		if (
			this.state.autoRecoverAttempts < maxAttempts &&
			this.isRecoverable(error)
		) {
			this.setState({ recovering: true });
			this.recoverTimer = setTimeout(() => {
				this.setState((prev) => ({
					hasError: false,
					error: null,
					recovering: false,
					autoRecoverAttempts: prev.autoRecoverAttempts + 1,
				}));
			}, AUTO_RECOVER_DELAY);
		}
	}

	componentWillUnmount() {
		if (this.recoverTimer) clearTimeout(this.recoverTimer);
	}

	/** 모듈 import 실패는 브라우저 캐시 문제 → 페이지 전체 리로드만이 해결책 */
	private needsHardReload(error: Error): boolean {
		const msg = error.message.toLowerCase();
		return (
			msg.includes("importing a module") ||
			msg.includes("loading chunk") ||
			msg.includes("dynamically imported") ||
			msg.includes("failed to fetch dynamically")
		);
	}

	/** 자동 복구 가능한 에러 유형 판단 */
	private isRecoverable(error: Error): boolean {
		const msg = error.message.toLowerCase();
		// 모듈 에러는 re-mount로 안 고쳐짐 — needsHardReload에서 별도 처리
		if (this.needsHardReload(error)) return false;
		// 네트워크, 비동기 에러 → 자동 복구 시도
		if (msg.includes("fetch") || msg.includes("network")) return true;
		if (msg.includes("cannot read") || msg.includes("undefined")) return true;
		if (msg.includes("timeout")) return true;
		if (msg.includes("hydrat") || msg.includes("render")) return true;
		return false;
	}

	handleReset = () => {
		if (this.recoverTimer) clearTimeout(this.recoverTimer);
		this.setState({
			hasError: false,
			error: null,
			autoRecoverAttempts: 0,
			recovering: false,
		});
	};

	handleGoHome = () => {
		if (this.recoverTimer) clearTimeout(this.recoverTimer);
		this.setState({
			hasError: false,
			error: null,
			autoRecoverAttempts: 0,
			recovering: false,
		});
		window.location.href = "/dashboard";
	};

	render() {
		if (!this.state.hasError) return this.props.children;

		// 자동 복구 중
		if (this.state.recovering) {
			return (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "50vh",
						padding: 40,
						gap: 12,
					}}
				>
					<div
						style={{
							width: 32,
							height: 32,
							border: "3px solid rgba(255,255,255,0.2)",
							borderTopColor: "#fff",
							borderRadius: "50%",
							animation: "spin 0.8s linear infinite",
						}}
					/>
					<PText color="contrast-medium">
						자동 복구 중... (시도 {this.state.autoRecoverAttempts + 1}/
						{this.props.maxAutoRecover ?? 2})
					</PText>
					<style>
						{`@keyframes spin { to { transform: rotate(360deg) } }`}
					</style>
				</div>
			);
		}

		if (this.props.fallback) return this.props.fallback;

		// 자동 복구 실패 → 수동 복구 UI
		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					minHeight: "50vh",
					padding: 40,
					gap: 16,
				}}
			>
				<PHeading size="large" tag="h2">
					오류가 발생했습니다
				</PHeading>
				<PText color="contrast-medium" align="center">
					{this.state.error?.message ?? "알 수 없는 오류"}
				</PText>
				{this.state.autoRecoverAttempts > 0 && (
					<PText size="x-small" color="contrast-medium">
						자동 복구 {this.state.autoRecoverAttempts}회 시도 실패
					</PText>
				)}
				<div style={{ display: "flex", gap: 12, marginTop: 16 }}>
					<PButton onClick={this.handleReset}>다시 시도</PButton>
					<PButton variant="secondary" onClick={this.handleGoHome}>
						대시보드로 이동
					</PButton>
				</div>
			</div>
		);
	}
}
