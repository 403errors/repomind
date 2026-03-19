const EMOJI_SEQUENCE_REGEX =
    /(?:[#*0-9]\uFE0F?\u20E3)|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0E|\uFE0F)?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0E|\uFE0F)?)*|\p{Regional_Indicator}{2}/gu;

const EMOJI_TIDY_REGEX = /[\u200D\uFE0E\uFE0F]/g;

/**
 * Removes emoji sequences from user-visible text while preserving normal symbols.
 * This is intentionally conservative so markdown, code, and ASCII punctuation survive intact.
 */
export function stripEmojiCharacters(text: string): string {
    return text.replace(EMOJI_SEQUENCE_REGEX, "").replace(EMOJI_TIDY_REGEX, "");
}
