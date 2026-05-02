import { PSpinner } from "@porsche-design-system/components-react";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import AppLayout from "./layouts/AppLayout";
import { ApiKeysProvider } from "./lib/api-keys-status";
import { installErrorSink } from "./lib/diag";

// Lazy-loaded pages for code splitting
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const SignupPage = lazy(() => import("./pages/auth/SignupPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ChannelListPage = lazy(() => import("./pages/channels/ChannelListPage"));
const ChannelFormPage = lazy(() => import("./pages/channels/ChannelFormPage"));
const ChannelDetailPage = lazy(
	() => import("./pages/channels/ChannelDetailPage"),
);
const StyleBiblePage = lazy(() => import("./pages/StyleBiblePage"));
const ReferenceListPage = lazy(
	() => import("./pages/references/ReferenceListPage"),
);
const ReferenceImportPage = lazy(
	() => import("./pages/references/ReferenceImportPage"),
);
const ReferenceDetailPage = lazy(
	() => import("./pages/references/ReferenceDetailPage"),
);
const ContentListPage = lazy(() => import("./pages/content/ContentListPage"));
const ContentWizardPage = lazy(
	() => import("./pages/content/ContentWizardPage"),
);
const ContentDetailPage = lazy(
	() => import("./pages/content/ContentDetailPage"),
);
const TimelineEditor = lazy(() => import("./pages/content/TimelineEditor"));
const UploadsPage = lazy(() => import("./pages/UploadsPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const NicheResearchPage = lazy(() => import("./pages/NicheResearchPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));

function PageLoader() {
	return (
		<div className="flex items-center justify-center h-64">
			<PSpinner size="medium" />
		</div>
	);
}

export default function App() {
	// 전역 에러 싱크 (window error + unhandledrejection + fetch 4xx/5xx) 설치
	useEffect(() => {
		installErrorSink();
	}, []);

	return (
		<ErrorBoundary>
			<ApiKeysProvider>
				<BrowserRouter>
					<Suspense fallback={<PageLoader />}>
						<Routes>
							<Route path="/auth/login" element={<LoginPage />} />
							<Route path="/auth/signup" element={<SignupPage />} />

							<Route element={<AppLayout />}>
								<Route path="/dashboard" element={<DashboardPage />} />
								<Route path="/channels" element={<ChannelListPage />} />
								<Route path="/channels/new" element={<ChannelFormPage />} />
								<Route path="/channels/:id" element={<ChannelDetailPage />} />
								<Route
									path="/channels/:id/edit"
									element={<ChannelFormPage />}
								/>
								<Route path="/style-bible" element={<StyleBiblePage />} />
								<Route path="/references" element={<ReferenceListPage />} />
								<Route
									path="/references/import"
									element={<ReferenceImportPage />}
								/>
								<Route
									path="/references/:id"
									element={<ReferenceDetailPage />}
								/>
								<Route path="/content" element={<ContentListPage />} />
								<Route path="/content/new" element={<ContentWizardPage />} />
								<Route path="/content/:id" element={<ContentDetailPage />} />
								<Route
									path="/content/:id/editor"
									element={<TimelineEditor />}
								/>
								<Route path="/uploads" element={<UploadsPage />} />
								<Route path="/analytics" element={<AnalyticsPage />} />
								<Route path="/niche-research" element={<NicheResearchPage />} />
								<Route path="/settings" element={<SettingsPage />} />
								<Route path="/diagnostics" element={<DiagnosticsPage />} />
							</Route>

							<Route path="*" element={<Navigate to="/dashboard" replace />} />
						</Routes>
					</Suspense>
				</BrowserRouter>
			</ApiKeysProvider>
		</ErrorBoundary>
	);
}
