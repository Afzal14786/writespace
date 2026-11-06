import type {
  ContentDocument,
  ContentInlineNode,
} from "../../../db/schema/content-document";

/**
 * Default Article reading speed.
 *
 * This is an estimate for reasonably readable prose.
 * Code blocks are included in the extracted text and can influence
 * the estimate, so treat the result as an approximate reading time.
 */
const WORDS_PER_MINUTE = 200;

/**
 * Default maximum length for an automatically generated excerpt.
 */
const DEFAULT_EXCERPT_LENGTH = 200;

/**
 * Extract readable text from a structured Article document.
 *
 * Rules:
 * - Text nodes contribute their text.
 * - Link nodes contribute their visible text, not their URL.
 * - Mention nodes are omitted because they contain user IDs.
 * - Code blocks contribute their source code.
 *
 * Paragraphs and code blocks are separated by blank lines so that
 * the resulting text remains readable.
 */
export function extractArticleText(document: ContentDocument): string {
  return document.blocks
    .map((block) => {
      if (block.type === "code") {
        return block.code;
      }

      return block.children
        .map((node: ContentInlineNode) => {
          if (node.type === "mention") {
            return "";
          }

          return node.text;
        })
        .join("");
    })
    .join("\n\n")
    .trim();
}

/**
 * Count characters that contribute to the Article's textual content.
 *
 * Counting rules:
 * - Text node: count visible text.
 * - Link node: count visible link text, not its URL.
 * - Mention node: count zero characters.
 * - Code block: count source code characters.
 *
 * This utility calculates a count; the Article DTO or command service
 * remains responsible for enforcing any configured content limit.
 */
export function countArticleCharacters(document: ContentDocument): number {
  return document.blocks.reduce((total, block) => {
    if (block.type === "code") {
      return total + block.code.length;
    }

    return (
      total +
      block.children.reduce((paragraphTotal, node) => {
        if (node.type === "mention") {
          return paragraphTotal;
        }

        return paragraphTotal + node.text.length;
      }, 0)
    );
  }, 0);
}

/**
 * Count readable words in Article content.
 *
 * Unicode-aware matching supports English and other languages
 * containing Unicode letters and numbers.
 */
export function countArticleWords(document: ContentDocument): number {
  const text = extractArticleText(document);

  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);

  return words?.length ?? 0;
}

/**
 * Calculate estimated Article reading time in minutes.
 *
 * Reading time is rounded up and never falls below one minute.
 * An empty document therefore returns one minute until the Article
 * contains enough content to produce a meaningful estimate.
 */
export function calculateArticleReadTime(document: ContentDocument): number {
  const wordCount = countArticleWords(document);

  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/**
 * Truncate text without splitting Unicode characters.
 *
 * Array.from() handles Unicode code points, avoiding malformed
 * strings when content contains emoji or other supplementary characters.
 */
function truncateText(value: string, maxLength: number): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError("Excerpt maximum length must be a positive integer");
  }

  const characters = Array.from(value);

  if (characters.length <= maxLength) {
    return value;
  }

  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * Generate an excerpt from the Article's structured document.
 *
 * The excerpt is intended for feed cards, search results,
 * social previews, and other compact content representations.
 *
 * An explicitly supplied Article excerpt should take precedence
 * over this generated value in the command service.
 */
export function generateArticleExcerpt(
  document: ContentDocument,
  maxLength = DEFAULT_EXCERPT_LENGTH,
): string {
  const readableText = extractArticleText(document);

  // Normalize whitespace so paragraphs do not produce awkward gaps
  // in compact previews.
  const normalizedText = readableText.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "";
  }

  return truncateText(normalizedText, maxLength);
}

/**
 * Collect unique mentioned user IDs from an Article document.
 *
 * The document stores mention locations, while content_mentions
 * stores one row per unique mentioned user for lookup and notifications.
 *
 * A user mentioned multiple times in one Article is returned only once.
 */
export function collectArticleMentionedUserIds(
  document: ContentDocument,
): string[] {
  const mentionedUserIds = new Set<string>();

  for (const block of document.blocks) {
    if (block.type !== "paragraph") {
      continue;
    }

    for (const node of block.children) {
      if (node.type === "mention") {
        mentionedUserIds.add(node.userId);
      }
    }
  }

  return [...mentionedUserIds];
}
