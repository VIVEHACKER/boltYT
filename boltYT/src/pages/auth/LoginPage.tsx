import {
	PButton,
	PHeading,
	PIcon,
	PInputText,
	PText,
} from "@porsche-design-system/components-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);

		const { error: authError } = await supabase.auth.signInWithPassword({
			email,
			password,
		});

		if (authError) {
			setError(authError.message);
			setLoading(false);
			return;
		}

		navigate("/dashboard");
	}

	return (
		<div className="min-h-screen bg-canvas flex items-center justify-center p-fluid-md">
			<div className="w-full max-w-[420px] bg-surface rounded-[12px] p-fluid-lg">
				<div className="flex items-center gap-static-sm mb-fluid-md">
					<PIcon name="video" size="medium" />
					<PHeading size="large" tag="h1">
						YT Studio AI
					</PHeading>
				</div>

				<PText color="contrast-medium" size="small">
					AI 기반 유튜브 자동화 플랫폼에 로그인하세요.
				</PText>

				<form
					onSubmit={handleSubmit}
					className="mt-fluid-md flex flex-col gap-static-md"
				>
					<PInputText
						name="email"
						label="이메일"
						placeholder="email@example.com"
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						state={error ? "error" : "none"}
					/>

					<PInputText
						name="password"
						label="비밀번호"
						placeholder="비밀번호를 입력하세요"
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						state={error ? "error" : "none"}
						message={error}
					/>

					<PButton type="submit" loading={loading} className="w-full">
						로그인
					</PButton>
				</form>

				<div className="mt-fluid-sm text-center">
					<PText size="small" color="contrast-medium">
						계정이 없으신가요?{" "}
						<Link to="/auth/signup" className="text-primary underline">
							회원가입
						</Link>
					</PText>
				</div>
			</div>
		</div>
	);
}
