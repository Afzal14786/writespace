import type {
  ContentDocument,
  ContentInlineNode,
} from "../../../db/schema/content-document";

/**
 * Returns the text that contributes to a Post's character limit.
 *
 * Rules:
 * - Text nodes: count their text.
 * - Link nodes: count their visible text, not their URL.
 * - Mention nodes: count zero characters.
 * - Code blocks: count their source code.
 *
 * Keep this consistent with the validation rules in create-post.dto.ts.
 */
export function countContentDocumentCharacters(
  document: ContentDocument,
): number {
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
 * Extracts readable text from a structured document.
 *
 * This is useful for previews, search indexing, and metadata.
 * Mention nodes are omitted because they store user IDs rather than
 * display names. Resolve those separately when a display name is needed.
 */
export function extractContentText(document: ContentDocument): string {
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
    .join("\n");
}

/**
 * Returns unique mentioned user IDs in document order.
 *
 * A user mentioned multiple times in the same Post is returned only once.
 * This matches the uniqueness requirement of the content_mentions table.
 */
export function collectMentionedUserIds(document: ContentDocument): string[] {
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
