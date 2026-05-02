export interface ChannelBranding {
	channelName: string;
	channelHandle: string;
	tagline: string;
}

const STORAGE_KEY = "render_channel_branding";

export const DEFAULT_CHANNEL_BRANDING: ChannelBranding = {
	channelName: "내 채널",
	channelHandle: "@mychannel",
	tagline: "original story format",
};

function normalizeHandle(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function loadChannelBranding(): ChannelBranding {
	if (typeof localStorage === "undefined") return DEFAULT_CHANNEL_BRANDING;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return DEFAULT_CHANNEL_BRANDING;
	try {
		const parsed = JSON.parse(raw) as Partial<ChannelBranding>;
		return {
			channelName:
				typeof parsed.channelName === "string" && parsed.channelName.trim()
					? parsed.channelName.trim()
					: DEFAULT_CHANNEL_BRANDING.channelName,
			channelHandle:
				typeof parsed.channelHandle === "string" && parsed.channelHandle.trim()
					? normalizeHandle(parsed.channelHandle)
					: DEFAULT_CHANNEL_BRANDING.channelHandle,
			tagline:
				typeof parsed.tagline === "string" && parsed.tagline.trim()
					? parsed.tagline.trim()
					: DEFAULT_CHANNEL_BRANDING.tagline,
		};
	} catch {
		return DEFAULT_CHANNEL_BRANDING;
	}
}

export function saveChannelBranding(value: ChannelBranding): ChannelBranding {
	const branding: ChannelBranding = {
		channelName: value.channelName.trim() || DEFAULT_CHANNEL_BRANDING.channelName,
		channelHandle:
			normalizeHandle(value.channelHandle) ||
			DEFAULT_CHANNEL_BRANDING.channelHandle,
		tagline: value.tagline.trim() || DEFAULT_CHANNEL_BRANDING.tagline,
	};
	localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
	return branding;
}
