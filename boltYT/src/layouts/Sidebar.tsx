import {
	PButton,
	PDivider,
	PIcon,
	PText,
} from "@porsche-design-system/components-react";
import {
	Activity,
	ChartBar as BarChart3,
	FilePlus,
	FileText,
	Film,
	LayoutDashboard,
	Palette,
	Settings,
	Tv,
	Upload,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const navItems = [
	{ to: "/dashboard", label: "대시보드", icon: LayoutDashboard },
	{ to: "/channels", label: "채널 관리", icon: Tv },
	{ to: "/style-bible", label: "스타일 바이블", icon: Palette },
	{ to: "/references", label: "레퍼런스 템플릿", icon: Film },
	{ to: "/content", label: "내 콘텐츠", icon: FileText },
	{ to: "/content/new", label: "콘텐츠 생성", icon: FilePlus },
	{ to: "/uploads", label: "업로드 관리", icon: Upload },
	{ to: "/analytics", label: "성과 분석", icon: BarChart3 },
	{ to: "/settings", label: "설정", icon: Settings },
	{ to: "/diagnostics", label: "진단", icon: Activity },
];

interface SidebarProps {
	open?: boolean;
	onClose?: () => void;
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
	const navigate = useNavigate();

	async function handleLogout() {
		await supabase.auth.signOut();
		navigate("/auth/login");
	}

	function handleNavClick() {
		onClose?.();
	}

	return (
		<aside className="w-64 min-h-screen bg-surface flex flex-col border-r border-contrast-low">
			<div className="p-fluid-md">
				<div className="flex items-center gap-static-sm">
					<PIcon name="video" size="medium" />
					<PText weight="semi-bold" size="medium">
						YT Studio AI
					</PText>
				</div>
			</div>

			<PDivider />

			<nav className="flex-1 p-static-sm flex flex-col gap-static-xs">
				{navItems.map(({ to, label, icon: Icon }) => (
					<NavLink
						key={to}
						to={to}
						end
						onClick={handleNavClick}
						className={({ isActive }) =>
							`flex items-center gap-static-sm px-static-md py-static-sm rounded-[4px] transition-colors no-underline ${
								isActive
									? "bg-primary text-[#fff]"
									: "text-primary hover:bg-canvas"
							}`
						}
					>
						<Icon size={18} />
						<span className="text-[14px]">{label}</span>
					</NavLink>
				))}
			</nav>

			<div className="p-static-md">
				<PDivider />
				<div className="mt-static-sm">
					<PButton variant="ghost" icon="logout" onClick={handleLogout}>
						로그아웃
					</PButton>
				</div>
			</div>
		</aside>
	);
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
	return (
		<>
			{/* Desktop: always visible fixed sidebar */}
			<div className="hidden md:block">
				<SidebarContent />
			</div>

			{/* Mobile: slide-in drawer */}
			{open && (
				<div className="md:hidden fixed inset-0 z-50 flex">
					{/* Backdrop */}
					<button
						type="button"
						aria-label="사이드바 닫기"
						className="absolute inset-0 bg-[rgba(0,0,0,0.5)] cursor-pointer border-0 bg-transparent w-full"
						onClick={onClose}
					/>
					{/* Drawer panel */}
					<div
						className="relative z-10 flex translate-x-0 transition-transform duration-300"
						style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
					>
						<SidebarContent onClose={onClose} />
					</div>
				</div>
			)}
		</>
	);
}
