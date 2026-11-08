// Feishu rich rendering: convert assistant Markdown into a message card whose
// `markdown` element supports bold / italic / code blocks / lists / links.
// The JSON 1.0 card markdown subset does not support headings or pipe tables,
// so those are rewritten into constructs the client renders well.
const CARD_CHUNK = 3000;
const LANGUAGE_ALIASES = {
    text: 'plain_text',
    txt: 'plain_text',
    console: 'plain_text',
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    sh: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    dockerfile: 'docker_file',
};
const SUPPORTED_LANGUAGES = new Set([
    'plain_text', 'abap', 'ada', 'apache', 'apex', 'assembly', 'bash', 'c_sharp', 'cpp', 'c',
    'cmake', 'cobol', 'css', 'coffee_script', 'd', 'dart', 'delphi', 'diff', 'django',
    'docker_file', 'erlang', 'fortran', 'gherkin', 'go', 'graphql', 'groovy', 'html',
    'htmlbars', 'http', 'haskell', 'json', 'java', 'javascript', 'julia', 'kotlin', 'latex',
    'lisp', 'lua', 'matlab', 'makefile', 'markdown', 'nginx', 'objective_c',
    'opengl_shading_language', 'php', 'perl', 'powershell', 'prolog', 'properties',
    'protobuf', 'python', 'r', 'ruby', 'rust', 'sas', 'scss', 'sql', 'scala', 'scheme',
    'shell', 'solidity', 'swift', 'toml', 'thrift', 'typescript', 'vbscript',
    'visual_basic', 'xml', 'yaml',
]);
const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+.#-]*)\s*$/u;
const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/u;
const RULE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/u;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/u;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/u;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/u;
const QUOTE = /^\s*>\s?(.*)$/u;
function normalizeLanguage(raw) {
    const language = raw.trim().toLowerCase();
    if (!language)
        return '';
    const mapped = LANGUAGE_ALIASES[language] ?? language;
    return SUPPORTED_LANGUAGES.has(mapped) ? mapped : '';
}
function splitCells(line) {
    const inner = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
    const cells = [];
    let cell = '';
    let escaped = false;
    for (const character of inner) {
        if (escaped) {
            cell += character;
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '|') {
            cells.push(cell.trim());
            cell = '';
            continue;
        }
        cell += character;
    }
    cells.push(cell.trim());
    return cells;
}
function tableToBullets(header, rows) {
    const output = [];
    for (const row of rows) {
        const parts = [];
        for (let index = 0; index < header.length; index += 1) {
            const key = header[index] ?? '';
            const value = row[index] ?? '';
            if (!value)
                continue;
            parts.push(key ? `**${key}**：${value}` : value);
        }
        if (parts.length > 0)
            output.push(`- ${parts.join('；')}`);
    }
    return output;
}
/**
 * Rewrite assistant Markdown into the card `markdown` subset.
 * Code fences, inline code, bold, italic, links and lists pass through.
 */
export function toFeishuMarkdown(text) {
    const lines = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
    const output = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const fence = FENCE.exec(line ?? '');
        if (fence) {
            const language = normalizeLanguage(fence[2] ?? '');
            output.push('```' + language);
            index += 1;
            while (index < lines.length) {
                const inside = lines[index] ?? '';
                if (FENCE.test(inside)) {
                    output.push('```');
                    break;
                }
                output.push(inside);
                index += 1;
            }
            if (index >= lines.length)
                output.push('```');
            continue;
        }
        const header = TABLE_ROW.exec(line);
        const separator = lines[index + 1];
        if (header && separator !== undefined && TABLE_SEPARATOR.test(separator)) {
            const headerCells = splitCells(line);
            const rows = [];
            let cursor = index + 2;
            while (cursor < lines.length && TABLE_ROW.test(lines[cursor] ?? '') && !TABLE_SEPARATOR.test(lines[cursor] ?? '')) {
                rows.push(splitCells(lines[cursor] ?? ''));
                cursor += 1;
            }
            output.push(...tableToBullets(headerCells, rows));
            index = cursor - 1;
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            output.push(`**${heading[1]}**`);
            continue;
        }
        if (RULE.test(line)) {
            output.push('────────');
            continue;
        }
        const task = TASK.exec(line);
        if (task) {
            output.push(`${task[1] ?? ''}- ${(task[2] ?? '').toLowerCase() === 'x' ? '☑' : '☐'} ${task[3] ?? ''}`);
            continue;
        }
        const quote = QUOTE.exec(line);
        if (quote) {
            output.push(`│ ${quote[1]}`);
            continue;
        }
        output.push(line);
    }
    return output.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}
/**
 * Split card markdown into chunks without leaving a code fence open.
 */
export function splitCardMarkdown(markdown, limit = CARD_CHUNK) {
    const lines = String(markdown ?? '').split('\n');
    const chunks = [];
    let current = [];
    let size = 0;
    let openFence = '';
    const flush = () => {
        if (current.length === 0)
            return;
        let body = current.join('\n');
        if (openFence)
            body += '\n```';
        const trimmed = body.trim();
        if (trimmed)
            chunks.push(trimmed);
        current = [];
        size = 0;
        if (openFence) {
            current.push(openFence);
            size = openFence.length + 1;
        }
    };
    for (const line of lines) {
        const cost = line.length + 1;
        if (size + cost > limit && current.length > 0)
            flush();
        current.push(line);
        size += cost;
        const fence = FENCE.exec(line);
        if (fence) {
            if (openFence)
                openFence = '';
            else
                openFence = '```' + normalizeLanguage(fence[2] ?? '');
        }
    }
    flush();
    return chunks;
}
/** Build the interactive-card payload accepted by `im.message.create`. */
export function cardContent(markdown) {
    return JSON.stringify({
        config: { wide_screen_mode: true, update_multi: true },
        elements: [{ tag: 'markdown', content: String(markdown ?? ''), text_size: 'normal' }],
    });
}
export { CARD_CHUNK };
//# sourceMappingURL=format.js.map