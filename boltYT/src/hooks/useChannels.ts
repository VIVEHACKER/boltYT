import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Channel } from "../types/database";

interface ChannelsState {
	channels: Channel[];
	loading: boolean;
	selectedChannelId: string | null;
	setChannels: (channels: Channel[]) => void;
	setLoading: (loading: boolean) => void;
	setSelectedChannelId: (id: string | null) => void;
}

export const useChannelsStore = create<ChannelsState>((set) => ({
	channels: [],
	loading: true,
	selectedChannelId: null,
	setChannels: (channels) => set({ channels }),
	setLoading: (loading) => set({ loading }),
	setSelectedChannelId: (id) => set({ selectedChannelId: id }),
}));

export function useChannels() {
	const setChannels = useChannelsStore((s) => s.setChannels);
	const setLoading = useChannelsStore((s) => s.setLoading);
	const selectedChannelId = useChannelsStore((s) => s.selectedChannelId);
	const setSelectedChannelId = useChannelsStore((s) => s.setSelectedChannelId);
	const channels = useChannelsStore((s) => s.channels);
	const loading = useChannelsStore((s) => s.loading);

	const fetchChannels = useCallback(async () => {
		setLoading(true);
		const { data } = await supabase
			.from("channels")
			.select("*")
			.order("created_at", { ascending: false });
		setChannels(data ?? []);
		setLoading(false);
	}, [setChannels, setLoading]);

	useEffect(() => {
		void fetchChannels();
	}, [fetchChannels]);

	return {
		channels,
		loading,
		selectedChannelId,
		setChannels,
		setLoading,
		setSelectedChannelId,
		refetch: fetchChannels,
	};
}
