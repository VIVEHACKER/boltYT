import { PSpinner } from "@porsche-design-system/components-react";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Sidebar from "./Sidebar";

export default function AppLayout() {
	const { user, loading } = useAuth();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	if (loading) {
		return (
			<div className="min-h-screen bg-canvas flex items-center justify-center">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (!user) {
		return <Navigate to="/auth/login" replace />;
	}

	return (
		<div className="flex h-screen min-h-0 overflow-hidden bg-canvas">
			<Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
			<div className="flex-1 flex h-full min-h-0 flex-col min-w-0">
				{/* Mobile top bar with hamburger */}
				<div className="md:hidden shrink-0 flex items-center gap-static-sm p-static-sm border-b border-contrast-low bg-surface sticky top-0 z-40">
					<button
						type="button"
						aria-label="메뉴 열기"
						className="w-9 h-9 flex items-center justify-center rounded-[4px] hover:bg-canvas transition-colors cursor-pointer bg-transparent border-0"
						onClick={() => setSidebarOpen(true)}
					>
						<Menu size={20} />
					</button>
				</div>
				<main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-fluid-md">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
