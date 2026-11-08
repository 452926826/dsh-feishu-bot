declare const CARD_CHUNK = 3000;
/**
 * Rewrite assistant Markdown into the card `markdown` subset.
 * Code fences, inline code, bold, italic, links and lists pass through.
 */
export declare function toFeishuMarkdown(text: string): string;
/**
 * Split card markdown into chunks without leaving a code fence open.
 */
export declare function splitCardMarkdown(markdown: string, limit?: number): string[];
/** Build the interactive-card payload accepted by `im.message.create`. */
export declare function cardContent(markdown: string): string;
export { CARD_CHUNK };
//# sourceMappingURL=format.d.ts.map