export type TextEmphasisLayoutVariant = "single" | "stacked";

export interface TextEmphasisLayout {
	variant: TextEmphasisLayoutVariant;
	leadText?: string;
	focusText: string;
	splitWordIndex?: number;
}

function findPreferredSplit(words: string[]): number | null {
	if (words.length < 5) return null;

	const target =
		words.length <= 6 ? 2 : Math.max(2, Math.round(words.length * 0.4));
	const candidates = words
		.map((word, index) => ({ word, index }))
		.filter(({ index }) => index > 0 && index < words.length - 1)
		.filter(
			({ word }) =>
				/[,:;!?]$/.test(word) ||
				/^(하지만|그런데|이후|직후|결국|그리고|동시에|반면|그러나)$/u.test(
					word,
				),
		)
		.sort((a, b) => Math.abs(a.index - target) - Math.abs(b.index - target));

	if (candidates.length > 0) {
		const chosen = candidates[0];
		return /[,:;!?]$/.test(chosen.word) ? chosen.index + 1 : chosen.index;
	}

	return Math.max(2, Math.min(words.length - 2, target));
}

export function computeTextEmphasisLayout(text: string): TextEmphasisLayout {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const compactText = text.trim();

	if (words.length <= 4 && compactText.length <= 18) {
		return {
			variant: "single",
			focusText: compactText,
		};
	}

	const splitWordIndex = findPreferredSplit(words);
	if (!splitWordIndex) {
		return {
			variant: "single",
			focusText: compactText,
		};
	}

	const leadWords = words.slice(0, splitWordIndex);
	const focusWords = words.slice(splitWordIndex);
	const leadText = leadWords.join(" ").trim();
	const focusText = focusWords.join(" ").trim();

	if (!leadText || !focusText) {
		return {
			variant: "single",
			focusText: compactText,
		};
	}

	return {
		variant: "stacked",
		leadText,
		focusText,
		splitWordIndex,
	};
}
