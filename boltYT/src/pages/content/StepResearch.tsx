import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PInputText,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import {
	ArrowUpDown,
	ChevronDown,
	ChevronUp,
	FileText,
	ImagePlus,
	Link,
	Newspaper,
	Trash2,
	Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import TabButton from "../../components/TabButton";
import { useApiKeysStatus } from "../../lib/api-keys-context";
import type { ImageResult, NewsResult, VideoResult } from "../../lib/search";
import {
	fetchArticleBody,
	searchNaverImages,
	searchNaverNews,
	searchYouTubeVideos,
} from "../../lib/search";
import { supabase } from "../../lib/supabase";
import { sortByEventDate } from "../../lib/timeline";
import type { ReferenceTemplate } from "../../types/database";
import type { CollectedSource } from "./ContentWizardPage";

interface StepResearchProps {
	topicId: string;
	sources: CollectedSource[];
	referenceTemplate?: ReferenceTemplate | null;
	onSourcesChange: (sources: CollectedSource[]) => void;
	onNext: () => void;
	onBack: () => void;
}

export default function StepResearch({
	topicId,
	sources,
	referenceTemplate,
	onSourcesChange,
	onNext,
	onBack,
}: StepResearchProps) {
	const [topicTitle, setTopicTitle] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [newsResults, setNewsResults] = useState<NewsResult[]>([]);
	const [imageResults, setImageResults] = useState<ImageResult[]>([]);
	const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
	const [urlInput, setUrlInput] = useState("");
	const [urlTitle, setUrlTitle] = useState("");
	const [articleText, setArticleText] = useState("");
	const [articleTitle, setArticleTitle] = useState("");
	const [activeTab, setActiveTab] = useState<
		"news" | "images" | "videos" | "url" | "article"
	>("news");
	const [error, setError] = useState("");
	// 비동기 addNews에서 stale-closure 없이 최신 sources에 접근하기 위한 레퍼런스
	const sourcesRef = useRef(sources);
	sourcesRef.current = sources;
	const keysStatus = useApiKeysStatus();
	const services = {
		naver: keysStatus.naver,
		youtube: keysStatus.youtube,
		pexels: keysStatus.pexels,
		pixabay: keysStatus.pixabay,
	};
	const isDramaRecapReference =
		referenceTemplate?.id === "builtin-drama-recap-longform" ||
		/(드라마|영화|몰아보기|recap|movie|drama)/i.test(
			`${referenceTemplate?.name ?? ""} ${referenceTemplate?.source_title ?? ""}`,
		);

	// 키 상태가 바뀌었을 때 현재 활성 탭이 비가용이면 첫 가용 탭으로 전환 (초기 공백 방지)
	useEffect(() => {
		const availability: Record<typeof activeTab, boolean> = {
			news: services.naver,
			images: services.naver,
			videos: services.youtube,
			url: true,
			article: true,
		};
		if (!availability[activeTab]) {
			const firstAvailable = (
				["news", "images", "videos", "url", "article"] as const
			).find((k) => availability[k]);
			if (firstAvailable) setActiveTab(firstAvailable);
		}
	}, [activeTab, services.naver, services.youtube]);

	useEffect(() => {
		supabase
			.from("topics")
			.select("title")
			.eq("id", topicId)
			.maybeSingle()
			.then(({ data }) => {
				const title = data?.title ?? "";
				setTopicTitle(title);
				setSearchQuery(title);
			});
	}, [topicId]);

	async function handleSearch() {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setError("");

		try {
			const promises: Promise<void>[] = [];

			if (services.naver) {
				promises.push(
					searchNaverNews(searchQuery)
						.then(setNewsResults)
						.catch(() => {}),
					searchNaverImages(searchQuery)
						.then(setImageResults)
						.catch(() => {}),
				);
			}
			if (services.youtube) {
				promises.push(
					searchYouTubeVideos(searchQuery)
						.then(setVideoResults)
						.catch(() => {}),
				);
			}

			if (promises.length === 0) {
				setError(
					"검색 API 키가 설정되지 않았습니다. 설정에서 네이버 또는 YouTube API 키를 등록하세요.",
				);
			}

			await Promise.all(promises);
		} catch (err) {
			setError(err instanceof Error ? err.message : "검색 실패");
		} finally {
			setSearching(false);
		}
	}

	const [fetchingUrls, setFetchingUrls] = useState<Set<string>>(new Set());

	function updateSource(id: string, patch: Partial<CollectedSource>) {
		onSourcesChange(
			sources.map((source) =>
				source.id === id ? { ...source, ...patch } : source,
			),
		);
	}

	function moveSource(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= sources.length) return;
		const next = [...sources];
		const [item] = next.splice(index, 1);
		next.splice(nextIndex, 0, item);
		onSourcesChange(next);
	}

	function sortSourcesByTimeline() {
		onSourcesChange(sortByEventDate(sources));
	}

	async function addNews(news: NewsResult) {
		const originalUrl = news.originallink || news.link;
		const id = crypto.randomUUID();
		// 즉시 스켈레톤 등록 (사용자 피드백) — bodyText는 뒤에서 채움
		const placeholder: CollectedSource = {
			id,
			type: "article",
			url: originalUrl,
			title: news.title,
			description: news.description,
			pubDate: news.pubDate,
			publisher: (() => {
				try {
					return new URL(originalUrl).hostname.replace(/^www\./, "");
				} catch {
					return "";
				}
			})(),
			eventTitle: news.title,
		};
		onSourcesChange([...sources, placeholder]);

		setFetchingUrls((prev) => {
			const next = new Set(prev);
			next.add(originalUrl);
			return next;
		});
		try {
			const article = await fetchArticleBody(originalUrl);
			// StepResearch가 리렌더된 상태의 sources를 참조하려면 컴포넌트 외부에서
			// onSourcesChange를 호출할 때 최신 배열을 만들어야 함.
			// 부모(ContentWizard)가 sources 상태 보유 → 여기선 부모에 최신 배열 전달.
			onSourcesChange(
				sourcesRef.current.map((s) =>
					s.id === id
						? {
								...s,
								bodyText: article.body || undefined,
								publisher: article.publisher || s.publisher,
								title: article.title || s.title,
								thumbnail: article.thumbnail || s.thumbnail,
								eventTitle:
									s.eventTitle && s.eventTitle !== s.title
										? s.eventTitle
										: article.title || s.eventTitle || s.title,
							}
						: s,
				),
			);
		} finally {
			setFetchingUrls((prev) => {
				const next = new Set(prev);
				next.delete(originalUrl);
				return next;
			});
		}
	}

	function addImage(img: ImageResult) {
		onSourcesChange([
			...sources,
			{
				id: crypto.randomUUID(),
				type: "image",
				url: img.link,
				title: img.title,
				thumbnail: img.thumbnail,
				eventTitle: img.title,
			},
		]);
	}

	function addVideo(vid: VideoResult) {
		onSourcesChange([
			...sources,
			{
				id: crypto.randomUUID(),
				type: "video",
				url: `https://www.youtube.com/watch?v=${vid.videoId}`,
				title: vid.title,
				thumbnail: vid.thumbnail,
				description: vid.description,
				publisher: vid.channelTitle,
				eventTitle: vid.title,
			},
		]);
	}

	function addFromUrl() {
		if (!urlInput.trim()) return;
		const isVideo =
			urlInput.includes("youtube.com") ||
			urlInput.includes("youtu.be") ||
			urlInput.endsWith(".mp4");
		onSourcesChange([
			...sources,
			{
				id: crypto.randomUUID(),
				type: isVideo ? "video" : "image",
				url: urlInput.trim(),
				title: urlTitle.trim() || "자료",
				thumbnail: isVideo ? "" : urlInput.trim(),
				eventTitle: urlTitle.trim() || "자료",
			},
		]);
		setUrlInput("");
		setUrlTitle("");
	}

	function addArticle() {
		if (!articleText.trim()) return;
		onSourcesChange([
			...sources,
			{
				id: crypto.randomUUID(),
				type: "article",
				url: "",
				title: articleTitle.trim() || "참고 기사",
				description: articleText.trim(),
				bodyText: articleText.trim(),
				eventTitle: articleTitle.trim() || "참고 기사",
			},
		]);
		setArticleText("");
		setArticleTitle("");
	}

	function removeSource(id: string) {
		onSourcesChange(sources.filter((s) => s.id !== id));
	}

	const isAlreadyAdded = (url: string) => sources.some((s) => s.url === url);

	const tabs = [
		{
			key: "news" as const,
			label: "뉴스",
			icon: <Newspaper size={14} />,
			available: services.naver,
		},
		{
			key: "images" as const,
			label: "이미지",
			icon: <ImagePlus size={14} />,
			available: services.naver,
		},
		{
			key: "videos" as const,
			label: "영상",
			icon: <Video size={14} />,
			available: services.youtube,
		},
		{
			key: "url" as const,
			label: "URL 직접 입력",
			icon: <Link size={14} />,
			available: true,
		},
		{
			key: "article" as const,
			label: "텍스트 붙여넣기",
			icon: <FileText size={14} />,
			available: true,
		},
	];

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<div className="flex items-center gap-static-sm mb-static-sm">
				<PHeading size="medium" tag="h2">
					자료 수집
				</PHeading>
				<PTag color="background-frosted">{topicTitle}</PTag>
			</div>
			<PText size="small" color="contrast-medium" className="mb-static-md">
				실제 뉴스, 사진, 영상 자료를 검색하고 수집하세요. AI가 이 자료를
				기반으로 스크립트를 작성합니다. 아래 목록에서 사건 시점 순서를 정리하고,
				기사 발행일은 참고용으로만 확인할 수 있습니다.
			</PText>

			{isDramaRecapReference && (
				<PInlineNotification
					state="info"
					dismissButton={false}
					className="mb-static-md"
					heading="드라마/영화 몰아보기 자료 기준"
					description="작품 제목, 공식 소개, 인물 관계, 줄거리 요약, 리뷰/해설 자료를 모아주세요. 원본 영상과 음악을 그대로 쓰는 방식이 아니라, 자료를 바탕으로 새 해설 대본·BGM·TTS 톤을 구성합니다."
				/>
			)}

			{/* Search bar */}
			<div className="flex gap-static-sm mb-static-md">
				<div className="flex-1">
					<PInputText
						name="search"
						label="검색"
						hideLabel
						placeholder={
							isDramaRecapReference
								? "작품명 + 줄거리/등장인물/결말/리뷰 (예: 패밀리 장혁 장나라 줄거리)"
								: "검색어를 입력하세요 (예: 이형호 사건, 화성연쇄살인)"
						}
						value={searchQuery}
						onInput={(e) =>
							setSearchQuery((e.target as HTMLInputElement).value)
						}
					/>
				</div>
				<PButton compact onClick={handleSearch} loading={searching}>
					검색
				</PButton>
			</div>

			{!services.naver && !services.youtube && (
				<PInlineNotification
					state="warning"
					dismissButton={false}
					className="mb-static-md"
				>
					실제 자료를 검색하려면 설정에서 API 키를 등록하세요: 네이버 개발자 API
					(뉴스/이미지), YouTube Data API (영상). 등록 없이도 URL 직접 입력이나
					텍스트 붙여넣기는 가능합니다.
				</PInlineNotification>
			)}

			{error && (
				<PInlineNotification
					state="error"
					dismissButton={false}
					className="mb-static-md"
				>
					{error}
				</PInlineNotification>
			)}

			{/* Tabs */}
			<div className="flex gap-static-xs mb-static-md overflow-x-auto">
				{tabs
					.filter((t) => t.available)
					.map((tab) => (
						<TabButton
							key={tab.key}
							active={activeTab === tab.key}
							onClick={() => setActiveTab(tab.key)}
							className="flex items-center gap-1 whitespace-nowrap"
						>
							{tab.icon}
							{tab.label}
						</TabButton>
					))}
			</div>

			{/* News results */}
			{activeTab === "news" && (
				<div className="mb-static-lg">
					{searching && (
						<div className="flex items-center gap-static-sm py-static-md">
							<PSpinner size="small" />
							<PText size="small" color="contrast-medium">
								뉴스를 검색하고 있습니다...
							</PText>
						</div>
					)}
					{newsResults.length > 0 && (
						<div className="flex flex-col gap-static-xs">
							{newsResults.map((news) => (
								<div
									key={news.link}
									className="bg-canvas rounded-[4px] p-static-sm flex items-start gap-static-sm"
								>
									<div className="flex-1 min-w-0">
										<PText size="small" weight="semi-bold">
											{news.title}
										</PText>
										<PText
											size="x-small"
											color="contrast-medium"
											className="mt-static-xs"
										>
											{news.description.slice(0, 150)}...
										</PText>
										<PText
											size="x-small"
											color="contrast-medium"
											className="mt-static-xs"
										>
											{new Date(news.pubDate).toLocaleDateString("ko-KR")}
										</PText>
									</div>
									<div className="shrink-0 flex gap-static-xs">
										<a
											href={news.originallink || news.link}
											target="_blank"
											rel="noopener noreferrer"
											className="text-[12px] text-contrast-medium hover:text-primary"
										>
											원문
										</a>
										{isAlreadyAdded(news.originallink || news.link) ? (
											<PTag color="notification-success-soft">
												{fetchingUrls.has(news.originallink || news.link)
													? "본문 수집 중..."
													: "추가됨"}
											</PTag>
										) : (
											<PButton
												compact
												variant="secondary"
												onClick={() => addNews(news)}
											>
												추가
											</PButton>
										)}
									</div>
								</div>
							))}
						</div>
					)}
					{!searching && newsResults.length === 0 && services.naver && (
						<PText size="small" color="contrast-medium">
							검색 버튼을 눌러 뉴스를 찾아보세요.
						</PText>
					)}
				</div>
			)}

			{/* Image results */}
			{activeTab === "images" && (
				<div className="mb-static-lg">
					{searching && (
						<div className="flex items-center gap-static-sm py-static-md">
							<PSpinner size="small" />
							<PText size="small" color="contrast-medium">
								이미지를 검색하고 있습니다...
							</PText>
						</div>
					)}
					{imageResults.length > 0 && (
						<div className="grid grid-cols-3 md:grid-cols-4 gap-static-xs">
							{imageResults.map((img) => (
								<button
									key={img.link}
									type="button"
									className={`relative aspect-video rounded-[4px] overflow-hidden cursor-pointer border-2 transition-colors group ${
										isAlreadyAdded(img.link)
											? "border-primary opacity-60"
											: "border-transparent hover:border-primary"
									}`}
									onClick={() => !isAlreadyAdded(img.link) && addImage(img)}
									disabled={isAlreadyAdded(img.link)}
								>
									<img
										src={img.thumbnail}
										alt={img.title}
										className="w-full h-full object-cover"
									/>
									<div className="absolute inset-0 bg-[rgba(0,0,0,0.4)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
										{isAlreadyAdded(img.link) ? (
											<PText size="x-small" color="contrast-high">
												추가됨
											</PText>
										) : (
											<ImagePlus size={20} className="text-[#fff]" />
										)}
									</div>
								</button>
							))}
						</div>
					)}
				</div>
			)}

			{/* Video results */}
			{activeTab === "videos" && (
				<div className="mb-static-lg">
					{searching && (
						<div className="flex items-center gap-static-sm py-static-md">
							<PSpinner size="small" />
							<PText size="small" color="contrast-medium">
								영상을 검색하고 있습니다...
							</PText>
						</div>
					)}
					{videoResults.length > 0 && (
						<div className="flex flex-col gap-static-xs">
							{videoResults.map((vid) => (
								<div
									key={vid.videoId}
									className="bg-canvas rounded-[4px] p-static-sm flex items-center gap-static-sm"
								>
									<div className="w-28 h-16 rounded-[2px] overflow-hidden shrink-0">
										<img
											src={vid.thumbnail}
											alt={vid.title}
											className="w-full h-full object-cover"
										/>
									</div>
									<div className="flex-1 min-w-0">
										<PText size="small" weight="semi-bold" ellipsis>
											{vid.title}
										</PText>
										<PText size="x-small" color="contrast-medium">
											{vid.channelTitle}
										</PText>
									</div>
									{isAlreadyAdded(
										`https://www.youtube.com/watch?v=${vid.videoId}`,
									) ? (
										<PTag color="notification-success-soft">추가됨</PTag>
									) : (
										<PButton
											compact
											variant="secondary"
											onClick={() => addVideo(vid)}
										>
											추가
										</PButton>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* URL tab */}
			{activeTab === "url" && (
				<div className="mb-static-lg flex flex-col gap-static-sm">
					<PInputText
						name="urlTitle"
						label="자료 제목"
						placeholder="이 자료의 제목 (선택)"
						value={urlTitle}
						onInput={(e) => setUrlTitle((e.target as HTMLInputElement).value)}
					/>
					<PInputText
						name="urlInput"
						label="이미지/영상 URL"
						placeholder="https://... (이미지 URL 또는 YouTube 링크)"
						value={urlInput}
						onInput={(e) => setUrlInput((e.target as HTMLInputElement).value)}
					/>
					<PButton compact variant="secondary" onClick={addFromUrl}>
						자료 추가
					</PButton>
				</div>
			)}

			{/* Article tab */}
			{activeTab === "article" && (
				<div className="mb-static-lg flex flex-col gap-static-sm">
					<PInputText
						name="articleTitle"
						label="기사/출처 제목"
						placeholder="예: OO일보 2026.04.14 - 사건 제목"
						value={articleTitle}
						onInput={(e) =>
							setArticleTitle((e.target as HTMLInputElement).value)
						}
					/>
					<PTextarea
						name="articleText"
						label="기사 내용 / 참고 텍스트"
						placeholder="뉴스 기사나 참고 자료 내용을 그대로 붙여넣기 하세요. 구체적인 내용이 많을수록 스크립트가 자세해집니다."
						value={articleText}
						rows={8}
						onInput={(e) =>
							setArticleText((e.target as HTMLTextAreaElement).value)
						}
					/>
					<PButton compact variant="secondary" onClick={addArticle}>
						자료 추가
					</PButton>
				</div>
			)}

			<PDivider className="my-static-md" />

			{/* Collected sources */}
			<div className="flex items-center justify-between gap-static-sm mb-static-sm">
				<PHeading size="small" tag="h3">
					수집된 자료 ({sources.length}개)
				</PHeading>
				{sources.length > 1 && (
					<PButton compact variant="secondary" onClick={sortSourcesByTimeline}>
						<ArrowUpDown size={14} />
						사건 시점순 정렬
					</PButton>
				)}
			</div>

			{sources.length === 0 ? (
				<div className="bg-canvas rounded-[4px] p-static-lg text-center mb-static-lg">
					<PText color="contrast-medium">
						위에서 뉴스/이미지/영상을 검색하고 추가하세요.
					</PText>
				</div>
			) : (
				<div className="flex flex-col gap-static-xs mb-static-lg">
					{sources.map((source, i) => (
						<div
							key={source.id}
							className="bg-canvas rounded-[4px] p-static-sm"
						>
							<div className="flex items-start gap-static-sm">
								<div className="w-6 h-6 rounded-full bg-surface flex items-center justify-center text-[11px] font-semibold shrink-0 mt-1">
									{i + 1}
								</div>
								{(source.type === "image" || source.type === "video") &&
									source.thumbnail && (
										<div className="w-16 h-10 rounded-[2px] overflow-hidden shrink-0 mt-1">
											<img
												src={source.thumbnail}
												alt={source.title}
												className="w-full h-full object-cover"
											/>
										</div>
									)}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-static-xs flex-wrap">
										<PText size="small" ellipsis>
											{source.title}
										</PText>
										<PTag
											color={
												source.type === "article"
													? "background-surface"
													: source.type === "video"
														? "notification-warning-soft"
														: "notification-info-soft"
											}
										>
											{source.type === "article"
												? "기사"
												: source.type === "video"
													? "영상"
													: "이미지"}
										</PTag>
										{source.eventDate && (
											<PTag color="background-frosted">
												사건 {source.eventDate}
											</PTag>
										)}
										{source.pubDate && (
											<PTag color="background-surface">
												기사 {source.pubDate}
											</PTag>
										)}
									</div>
									{source.description && (
										<PText
											size="x-small"
											color="contrast-medium"
											className="mt-static-xs"
											ellipsis
										>
											{source.description.slice(0, 90)}...
										</PText>
									)}

									<div className="mt-static-sm grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)] gap-static-xs">
										<input
											type="text"
											placeholder="사건 날짜 (예: 1991-01-29)"
											value={source.eventDate ?? ""}
											onChange={(e) =>
												updateSource(source.id, {
													eventDate: e.target.value,
												})
											}
											className="text-[12px] px-2 py-1.5 rounded border border-contrast-low bg-surface focus:border-primary outline-none"
										/>
										<input
											type="text"
											placeholder="이 자료가 보여줄 사건 순간"
											value={source.eventTitle ?? ""}
											onChange={(e) =>
												updateSource(source.id, {
													eventTitle: e.target.value,
												})
											}
											className="text-[12px] px-2 py-1.5 rounded border border-contrast-low bg-surface focus:border-primary outline-none"
										/>
									</div>
								</div>
								<div className="shrink-0 flex items-center gap-1">
									<button
										type="button"
										className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors cursor-pointer text-contrast-medium hover:text-primary bg-transparent border-0"
										onClick={() => moveSource(i, -1)}
										disabled={i === 0}
										aria-label="위로 이동"
									>
										<ChevronUp size={14} />
									</button>
									<button
										type="button"
										className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors cursor-pointer text-contrast-medium hover:text-primary bg-transparent border-0"
										onClick={() => moveSource(i, 1)}
										disabled={i === sources.length - 1}
										aria-label="아래로 이동"
									>
										<ChevronDown size={14} />
									</button>
									<button
										type="button"
										className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors cursor-pointer text-contrast-medium hover:text-primary bg-transparent border-0"
										onClick={() => removeSource(source.id)}
										aria-label="삭제"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			<div className="flex justify-between">
				<PButton variant="secondary" onClick={onBack}>
					이전
				</PButton>
				<PButton disabled={sources.length === 0} onClick={onNext}>
					다음: 스크립트 생성
				</PButton>
			</div>
		</div>
	);
}
