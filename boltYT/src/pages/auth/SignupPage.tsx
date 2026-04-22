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

export default function SignupPage() {
	const navigate = useNavigate();
	const [displayName, setDisplayName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);

		const { error: authError } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: { display_name: displayName },
			},
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
						회원가입
					</PHeading>
				</div>

				<PText color="contrast-medium" size="small">
					새 계정을 만들고 유튜브 자동화를 시작하세요.
				</PText>

				<form
					onSubmit={handleSubmit}
					className="mt-fluid-md flex flex-col gap-static-md"
				>
					<PInputText
						name="displayName"
						label="이름"
						placeholder="홍길동"
						value={displayName}
						onInput={(e) =>
							setDisplayName((e.target as HTMLInputElement).value)
						}
					/>

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
						placeholder="6자 이상 입력하세요"
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						state={error ? "error" : "none"}
						message={error}
					/>

					<PButton type="submit" loading={loading} className="w-full">
						가입하기
					</PButton>
				</form>

				<div className="mt-fluid-sm text-center">
					<PText size="small" color="contrast-medium">
						이미 계정이 있으신가요?{" "}
						<Link to="/auth/login" className="text-primary underline">
							로그인
						</Link>
					</PText>
				</div>
			</div>
		</div>
	);
}
