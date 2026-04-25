/**
 * useEditorPanels — 타임라인 에디터 패널 open/close 상태 관리.
 */

import { useState } from "react";

export interface EditorPanels {
	mixerOpen: boolean;
	setMixerOpen: React.Dispatch<React.SetStateAction<boolean>>;
	colorOpen: boolean;
	setColorOpen: React.Dispatch<React.SetStateAction<boolean>>;
	scopesOpen: boolean;
	setScopesOpen: React.Dispatch<React.SetStateAction<boolean>>;
	transformOpen: boolean;
	setTransformOpen: React.Dispatch<React.SetStateAction<boolean>>;
	motionOpen: boolean;
	setMotionOpen: React.Dispatch<React.SetStateAction<boolean>>;
	curvesOpen: boolean;
	setCurvesOpen: React.Dispatch<React.SetStateAction<boolean>>;
	fxOpen: boolean;
	setFxOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useEditorPanels(): EditorPanels {
	const [mixerOpen, setMixerOpen] = useState(false);
	const [colorOpen, setColorOpen] = useState(false);
	const [scopesOpen, setScopesOpen] = useState(false);
	const [transformOpen, setTransformOpen] = useState(false);
	const [motionOpen, setMotionOpen] = useState(false);
	const [curvesOpen, setCurvesOpen] = useState(false);
	const [fxOpen, setFxOpen] = useState(false);

	return {
		mixerOpen,
		setMixerOpen,
		colorOpen,
		setColorOpen,
		scopesOpen,
		setScopesOpen,
		transformOpen,
		setTransformOpen,
		motionOpen,
		setMotionOpen,
		curvesOpen,
		setCurvesOpen,
		fxOpen,
		setFxOpen,
	};
}
