import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSelect,
	PSelectOption,
	PSpinner,
	PTag,
	PText,
	PTextFieldWrapper,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import type { ChannelMember } from "../types/database";

interface Props {
	channelId: string;
}

const ROLE_LABELS: Record<ChannelMember["role"], string> = {
	owner: "소유자",
	editor: "편집자",
	viewer: "뷰어",
};

const ROLE_COLORS: Record<
	ChannelMember["role"],
	| "notification-info-soft"
	| "notification-success-soft"
	| "notification-warning-soft"
> = {
	owner: "notification-info-soft",
	editor: "notification-success-soft",
	viewer: "notification-warning-soft",
};

export default function ChannelMembersPanel({ channelId }: Props) {
	const { user } = useAuth();
	const [members, setMembers] = useState<ChannelMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
	const [inviting, setInviting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const loadMembers = useCallback(async () => {
		setLoading(true);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data, error: err } = await (supabase as any)
			.from("channel_members")
			.select("*")
			.eq("channel_id", channelId)
			.order("invited_at", { ascending: true });
		if (!err) setMembers((data as ChannelMember[]) ?? []);
		setLoading(false);
	}, [channelId]);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			void loadMembers();
		}, 0);
		return () => window.clearTimeout(timeout);
	}, [loadMembers]);

	const isOwner = members.some(
		(m) => m.user_id === user?.id && m.role === "owner",
	);

	async function handleInvite() {
		if (!inviteEmail.trim()) return;
		setInviting(true);
		setError(null);
		setSuccess(null);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error: err } = await (supabase as any)
			.from("channel_members")
			.insert({
				channel_id: channelId,
				email: inviteEmail.trim().toLowerCase(),
				role: inviteRole,
				invited_by: user?.id ?? null,
			});

		if (err) {
			const pgErr = err as { code?: string; message: string };
			setError(
				pgErr.code === "23505" ? "이미 초대된 이메일입니다." : err.message,
			);
		} else {
			setSuccess(`${inviteEmail} 님을 초대했습니다.`);
			setInviteEmail("");
			await loadMembers();
		}
		setInviting(false);
	}

	async function handleRemove(member: ChannelMember) {
		if (member.role === "owner") return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error: err } = await (supabase as any)
			.from("channel_members")
			.delete()
			.eq("id", member.id);
		if (!err) {
			setMembers((prev) => prev.filter((m) => m.id !== member.id));
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-static-sm py-static-md">
				<PSpinner size="small" />
				<PText size="small">멤버 불러오는 중…</PText>
			</div>
		);
	}

	return (
		<div>
			<PHeading size="small" tag="h2" className="mb-static-md">
				팀 멤버
			</PHeading>

			{members.length === 0 ? (
				<PText color="contrast-medium" size="small">
					아직 멤버가 없습니다.
				</PText>
			) : (
				<ul className="flex flex-col gap-static-sm mb-static-lg">
					{members.map((m) => (
						<li
							key={m.id}
							className="flex items-center justify-between p-static-sm bg-surface rounded-[8px]"
						>
							<div className="flex items-center gap-static-sm">
								<PText size="small" weight="semi-bold">
									{m.email}
								</PText>
								{!m.accepted_at && m.role !== "owner" && (
									<PTag color="notification-warning-soft">초대 대기</PTag>
								)}
							</div>
							<div className="flex items-center gap-static-sm">
								<PTag color={ROLE_COLORS[m.role]}>{ROLE_LABELS[m.role]}</PTag>
								{isOwner && m.role !== "owner" && (
									<PButton
										variant="ghost"
										compact
										icon="delete"
										aria-label="멤버 제거"
										onClick={() => handleRemove(m)}
									/>
								)}
							</div>
						</li>
					))}
				</ul>
			)}

			{isOwner && (
				<>
					<PDivider className="mb-static-lg" />
					<PHeading size="small" tag="h3" className="mb-static-sm">
						멤버 초대
					</PHeading>

					{error && (
						<PInlineNotification
							state="error"
							heading={error}
							dismissButton
							className="mb-static-sm"
							onDismiss={() => setError(null)}
						/>
					)}
					{success && (
						<PInlineNotification
							state="success"
							heading={success}
							dismissButton
							className="mb-static-sm"
							onDismiss={() => setSuccess(null)}
						/>
					)}

					<div className="flex gap-static-sm items-end">
						<div className="flex-1">
							<PTextFieldWrapper label="이메일">
								<input
									type="email"
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void handleInvite();
									}}
									placeholder="team@example.com"
									className="w-full"
								/>
							</PTextFieldWrapper>
						</div>
						<PSelect
							name="invite-role"
							value={inviteRole}
							onUpdate={(e) =>
								setInviteRole(e.detail.value as "editor" | "viewer")
							}
							label="역할"
						>
							<PSelectOption value="editor">편집자</PSelectOption>
							<PSelectOption value="viewer">뷰어</PSelectOption>
						</PSelect>
						<PButton
							loading={inviting}
							disabled={!inviteEmail.trim()}
							onClick={() => void handleInvite()}
							icon="add"
						>
							초대
						</PButton>
					</div>
				</>
			)}
		</div>
	);
}
