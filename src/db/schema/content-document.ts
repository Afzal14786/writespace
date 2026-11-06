/**
 * Shared structured-content contract for short Posts and long-form Articles.
 *
 * The editor stores content as an ordered list of blocks. Paragraph blocks
 * contain inline text, links, and registered-user mentions. Code blocks keep
 * their source text and language together.
 *
 * Images are deliberately NOT represented here: Post images are stored as
 * separate rows in `post_media`, which makes ordering and the five-image
 * limit easier to manage independently of the text document.
 *
 * This is a TypeScript shape, not runtime validation. API DTOs/services must
 * still validate block types, URLs, mention ownership/existence, and the
 * 6,000-character Post limit before writing JSONB.
 */

export interface ContentTextNode {
  type: "text";
  text: string;
}

export interface ContentLinkNode {
  type: "link";
  text: string;
  url: string;
}

export interface ContentMentionNode {
  type: "mention";
  userId: string;
}

export type ContentInlineNode =
  | ContentTextNode
  | ContentLinkNode
  | ContentMentionNode;

export interface ContentParagraphBlock {
  type: "paragraph";
  children: ContentInlineNode[];
}

export interface ContentCodeBlock {
  type: "code";
  language: string;
  code: string;
}

export type ContentBlock = ContentParagraphBlock | ContentCodeBlock;

export interface ContentDocument {
  /** Increment when the persisted document format changes incompatibly. */
  version: 1;
  blocks: ContentBlock[];
}

export const EMPTY_CONTENT_DOCUMENT: ContentDocument = {
  version: 1,
  blocks: [],
};
