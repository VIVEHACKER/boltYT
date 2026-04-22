export type SceneShotKind =
	| "establishing"
	| "context"
	| "detail"
	| "evidence"
	| "quote"
	| "punch";

export type SceneShotMotion =
	| "static"
	| "slow_zoom_in"
	| "slow_zoom_out"
	| "pan_left"
	| "pan_right"
	| "drift"
	| "push_in";

export type SceneShotCrop = "full" | "wide" | "medium" | "close" | "detail";

export type SceneShotOverlay =
	| "none"
	| "headline"
	| "quote"
	| "evidence"
	| "context";

export interface SceneShot {
	id: string;
	kind: SceneShotKind;
	duration_seconds: number;
	media_type?: "image" | "video";
	source_index?: number;
	source_url?: string;
	source_title?: string;
	visual_prompt?: string;
	caption?: string;
	motion?: SceneShotMotion;
	crop?: SceneShotCrop;
	overlay?: SceneShotOverlay;
	trim_start?: number;
	trim_end?: number;
	/** 샷별 독립 색보정 (노드 그래프). 씬 레벨 colorGraph보다 우선 적용. */
	colorGraph?: import("./color-graph").ColorGraph;
}
