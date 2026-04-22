interface TabButtonProps {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	className?: string;
}

export default function TabButton({
	active,
	onClick,
	children,
	className,
}: TabButtonProps) {
	return (
		<button
			type="button"
			className={`px-static-md py-static-xs rounded-[4px] text-[13px] border transition-colors cursor-pointer ${
				active
					? "bg-primary text-[#fff] border-primary"
					: "bg-canvas text-primary border-contrast-low hover:bg-contrast-low"
			}${className ? ` ${className}` : ""}`}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
