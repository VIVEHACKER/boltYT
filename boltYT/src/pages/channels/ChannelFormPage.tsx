import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

const categories = [
	"교육/지식",
	"기술/IT",
	"건강/의학",
	"재테크/금융",
	"자기계발",
	"역사/문화",
	"과학",
	"뉴스/시사",
	"엔터테인먼트",
	"기타",
];

const languages = [
	{ value: "ko", label: "한국어" },
	{ value: "en", label: "영어" },
	{ value: "ja", label: "일본어" },
	{ value: "zh", label: "중국어" },
];

export default function ChannelFormPage() {
	const navigate = useNavigate();
	const { id } = useParams();
	const { user } = useAuth();
	const isEdit = Boolean(id);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [language, setLanguage] = useState("ko");
	const [category, setCategory] = useState("");
	const [tone, setTone] = useState("");
	const [forbiddenWords, setForbiddenWords] = useState("");
	const [defaultCta, setDefaultCta] = useState("");
	const [visibilityPolicy, setVisibilityPolicy] = useState("private");
	const [loading, setLoading] = useState(false);
	const [pageLoading, setPageLoading] = useState(isEdit);
	const [error, setError] = useState("");

	useEffect(() => {
		if (isEdit && id) {
			supabase
				.from("channels")
				.select("*")
				.eq("id", id)
				.maybeSingle()
				.then(({ data }) => {
					if (data) {
						setName(data.name);
						setDescription(data.description);
						setLanguage(data.language);
						setCategory(data.category);
						setTone(data.tone);
						setForbiddenWords(data.forbidden_words?.join(", ") ?? "");
						setDefaultCta(data.default_cta);
						setVisibilityPolicy(data.visibility_policy);
					}
					setPageLoading(false);
				});
		}
	}, [id, isEdit]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) {
			setError("채널명을 입력해주세요.");
			return;
		}
		setError("");
		setLoading(true);

		const payload = {
			name: name.trim(),
			description: description.trim(),
			language,
			category,
			tone: tone.trim(),
			forbidden_words: forbiddenWords
				.split(",")
				.map((w) => w.trim())
				.filter(Boolean),
			default_cta: defaultCta.trim(),
			visibility_policy: visibilityPolicy,
			user_id: user?.id,
		};

		if (isEdit && id) {
			const { error: updateError } = await supabase
				.from("channels")
				.update({ ...payload, updated_at: new Date().toISOString() })
				.eq("id", id);
			if (updateError) {
				setError(updateError.message);
				setLoading(false);
				return;
			}
		} else {
			const { error: insertError } = await supabase
				.from("channels")
				.insert(payload);
			if (insertError) {
				setError(insertError.message);
				setLoading(false);
				return;
			}
		}

		navigate("/channels");
	}

	if (pageLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	return (
		<div className="max-w-2xl">
			<PHeading size="x-large" tag="h1" className="mb-static-sm">
				{isEdit ? "채널 수정" : "새 채널 만들기"}
			</PHeading>
			<PText color="contrast-medium" className="mb-fluid-md">
				채널의 기본 정보와 생성 규칙을 설정하세요.
			</PText>

			{error && (
				<PInlineNotification
					state="error"
					className="mb-static-md"
					dismissButton={false}
				>
					{error}
				</PInlineNotification>
			)}

			<form onSubmit={handleSubmit} className="flex flex-col gap-static-lg">
				<PInputText
					name="name"
					label="채널명"
					placeholder="예: AI 지식 채널"
					value={name}
					required
					onInput={(e) => setName((e.target as HTMLInputElement).value)}
				/>

				<PTextarea
					name="description"
					label="채널 설명"
					placeholder="채널에 대한 간단한 설명"
					value={description}
					rows={3}
					onInput={(e) =>
						setDescription((e.target as HTMLTextAreaElement).value)
					}
				/>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-static-md">
					<PSelect
						name="language"
						label="언어"
						value={language}
						onChange={(e) => setLanguage(e.detail.value)}
					>
						{languages.map((l) => (
							<PSelectOption key={l.value} value={l.value}>
								{l.label}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="category"
						label="카테고리"
						value={category}
						onChange={(e) => setCategory(e.detail.value)}
					>
						{categories.map((c) => (
							<PSelectOption key={c} value={c}>
								{c}
							</PSelectOption>
						))}
					</PSelect>
				</div>

				<PTextarea
					name="tone"
					label="톤앤매너"
					placeholder="예: 친근하고 쉬운 설명, 전문적이되 딱딱하지 않은 어조"
					value={tone}
					rows={2}
					onInput={(e) => setTone((e.target as HTMLTextAreaElement).value)}
				/>

				<PInputText
					name="forbiddenWords"
					label="금지어 (쉼표로 구분)"
					placeholder="예: 욕설, 정치, 종교"
					value={forbiddenWords}
					onInput={(e) =>
						setForbiddenWords((e.target as HTMLInputElement).value)
					}
				/>

				<PInputText
					name="defaultCta"
					label="기본 CTA 문구"
					placeholder="예: 구독과 좋아요 부탁드립니다!"
					value={defaultCta}
					onInput={(e) => setDefaultCta((e.target as HTMLInputElement).value)}
				/>

				<PSelect
					name="visibilityPolicy"
					label="기본 공개 정책"
					value={visibilityPolicy}
					onChange={(e) => setVisibilityPolicy(e.detail.value)}
				>
					<PSelectOption value="public">공개</PSelectOption>
					<PSelectOption value="unlisted">미등록</PSelectOption>
					<PSelectOption value="private">비공개</PSelectOption>
				</PSelect>

				<div className="flex gap-static-sm">
					<PButton type="submit" loading={loading}>
						{isEdit ? "저장" : "채널 만들기"}
					</PButton>
					<PButton
						variant="secondary"
						type="button"
						onClick={() => navigate("/channels")}
					>
						취소
					</PButton>
				</div>
			</form>
		</div>
	);
}
