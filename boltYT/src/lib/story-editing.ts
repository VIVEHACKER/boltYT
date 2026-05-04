export interface StoryEditDraft {
	hook: string;
	storyAngle: string;
	viewerQuestion: string;
	endingBeat: string;
	mustKeep: string;
	avoid: string;
	editorNotes: string;
	updatedAt: string;
}

export interface StorySceneInput {
	narration: string;
	type: string;
	visualPrompt: string;
	duration: number;
	newsTitle?: string;
	newsDate?: string;
	shots?: unknown[];
}

export function createEmptyStoryEditDraft(): StoryEditDraft {
	return {
		hook: "",
		storyAngle: "",
		viewerQuestion: "",
		endingBeat: "",
		mustKeep: "",
		avoid: "",
		editorNotes: "",
		updatedAt: new Date(0).toISOString(),
	};
}

export function buildStoryEditDraft(params: {
	shortsScript?: string;
	scenes?: StorySceneInput[];
	referenceName?: string;
	format?: string;
	now?: Date;
}): StoryEditDraft {
	const {
		shortsScript = "",
		scenes = [],
		referenceName = "",
		format = "both",
		now = new Date(),
	} = params;
	const firstScene = scenes[0];
	const lastScene = scenes.at(-1);
	const firstNarration = firstScene?.narration?.trim() ?? "";
	const lastNarration = lastScene?.narration?.trim() ?? "";
	const firstLine =
		shortsScript
			.split(/\n+/)
			.map((line) => line.trim())
			.find(Boolean) ?? "";
	const hook = clipText(firstNarration || firstLine, 140);
	const storyAngle = referenceName
		? `${referenceName}의 리듬과 화면 문법만 참고하고, 주제/사건 전개는 새롭게 구성`
		: "레퍼런스 문법은 유지하되 주제와 사건 전개는 새롭게 구성";
	const viewerQuestion = inferViewerQuestion(hook || firstLine);
	const endingBeat = clipText(lastNarration, 160);

	return {
		hook,
		storyAngle,
		viewerQuestion,
		endingBeat,
		mustKeep:
			format === "shorts"
				? "첫 3초 훅, 빠른 컷 전환, 한 문장 결론"
				: "챕터별 질문 회수, 90-150초마다 새 증거/전환 컷",
		avoid: "레퍼런스 원문/자막/음악/고유 표현을 그대로 복제하지 않기",
		editorNotes: "",
		updatedAt: now.toISOString(),
	};
}

export function summarizeStoryEditDraft(draft: StoryEditDraft): string {
	return [
		draft.hook && `훅: ${draft.hook}`,
		draft.storyAngle && `각도: ${draft.storyAngle}`,
		draft.viewerQuestion && `질문: ${draft.viewerQuestion}`,
		draft.endingBeat && `결말: ${draft.endingBeat}`,
		draft.mustKeep && `유지: ${draft.mustKeep}`,
		draft.avoid && `금지: ${draft.avoid}`,
		draft.editorNotes && `메모: ${draft.editorNotes}`,
	]
		.filter(Boolean)
		.join("\n");
}

export function moveStoryScene<T>(scenes: T[], index: number, direction: -1 | 1): T[] {
	const target = index + direction;
	if (index < 0 || index >= scenes.length || target < 0 || target >= scenes.length) {
		return scenes;
	}
	const next = [...scenes];
	const current = next[index];
	const other = next[target];
	if (current === undefined || other === undefined) return scenes;
	next[index] = other;
	next[target] = current;
	return next;
}

export function duplicateStoryScene<T extends StorySceneInput>(scenes: T[], index: number): T[] {
	const scene = scenes[index];
	if (!scene) return scenes;
	const copy = {
		...scene,
		narration: `${scene.narration}\n(복제한 씬입니다. 내용/스토리를 수정하세요.)`,
		shots: [],
	} as T;
	return [...scenes.slice(0, index + 1), copy, ...scenes.slice(index + 1)];
}

export function insertStorySceneAfter<T extends StorySceneInput>(
	scenes: T[],
	index: number,
	template?: Partial<T>,
): T[] {
	const duration = Math.max(4, Number(scenes[index]?.duration ?? 8));
	const scene = {
		narration: "",
		type: "image",
		visualPrompt: "",
		duration,
		shots: [],
		...template,
	} as T;
	const insertAt = Math.min(Math.max(index + 1, 0), scenes.length);
	return [...scenes.slice(0, insertAt), scene, ...scenes.slice(insertAt)];
}

export function deleteStoryScene<T>(scenes: T[], index: number): T[] {
	if (scenes.length <= 1 || index < 0 || index >= scenes.length) return scenes;
	return scenes.filter((_, sceneIndex) => sceneIndex !== index);
}

function clipText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function inferViewerQuestion(hook: string): string {
	const normalized = hook.trim();
	if (!normalized) return "시청자가 끝까지 봐야 해결되는 질문을 한 문장으로 고정";
	if (/[?？]$/.test(normalized)) return normalized;
	return `${clipText(normalized, 80)}의 진짜 이유는 무엇인가?`;
}
