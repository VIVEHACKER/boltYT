/**
 * 카드 길이(프레임 @30fps) — React/remotion 비의존 순수 상수.
 * CLI(make-vlog)가 .srt 인트로 오프셋·총길이 계산에 이 값이 필요한데, .tsx(React 컴포넌트)를
 * node 컨텍스트로 직접 import 하면 remotion 런타임이 끌려오므로 상수만 분리한다.
 * 컴포넌트(TitleCard/EndCard)는 이 값을 import 후 re-export 해 기존 import 경로를 유지한다.
 */
export const TITLE_CARD_FRAMES = 90;
export const END_CARD_FRAMES = 150;
