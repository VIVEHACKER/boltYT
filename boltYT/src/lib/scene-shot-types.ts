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

export type SceneShotVisualRole =
	| "evidence"
	| "archive"
	| "reconstruction"
	| "map"
	| "document"
	| "data"
	| "context"
	| "transition"
	| "ending";

export type AnimationRigExpression =
	| "neutral"
	| "happy"
	| "worried"
	| "surprised"
	| "angry"
	| "fear"
	| "determined";

export type AnimationRigMouthCue =
	| "closed"
	| "open"
	| "wide"
	| "smile";

export type AnimationRigPose =
	| "front"
	| "three_quarter"
	| "profile"
	| "action";

export interface AnimationRigInstruction {
	expression: AnimationRigExpression;
	mouthCue: AnimationRigMouthCue;
	pose: AnimationRigPose;
	actionIntensity: number;
}

export interface AnimationSfxCue {
	category:
		| "whoosh"
		| "impact"
		| "tension_rise"
		| "reveal"
		| "glitch"
		| "dark_ambient"
		| "notification"
		| "suspense_hit"
		| "bell"
		| "drone"
		| "woosh_tail"
		| "none";
	intensity: number;
	reason: string;
}

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
	visual_role?: SceneShotVisualRole;
	search_terms?: string[];
	reject_terms?: string[];
	source_confidence?: number;
	quality_score?: number;
	dynamic_score?: number;
	dynamic_issues?: string[];
	selection_provider?: string;
	rejection_reason?: string;
	animation_family?: string;
	continuity_key?: string;
	reference_image_path?: string;
	animation_rig?: AnimationRigInstruction;
	sfx_cue?: AnimationSfxCue;
	qc_score?: number;
	qc_issues?: string[];
	/** 샷별 독립 색보정 (노드 그래프). 씬 레벨 colorGraph보다 우선 적용. */
	colorGraph?: import("./color-graph").ColorGraph;
}
