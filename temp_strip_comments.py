from pathlib import Path

root = Path(r'c:\\moj')
exts = {'.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css'}


def strip_js_comments(text: str) -> str:
    out = []
    i = 0
    state = 'code'
    escape = False
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if state == 'code':
            if ch in ("'", '"', '`'):
                out.append(ch)
                state = ch
                i += 1
            elif ch == '/' and nxt == '/':
                state = 'line_comment'
                i += 2
            elif ch == '/' and nxt == '*':
                state = 'block_comment'
                i += 2
            else:
                out.append(ch)
                i += 1
        elif state == 'line_comment':
            if ch == '\n':
                out.append(ch)
                state = 'code'
            i += 1
        elif state == 'block_comment':
            if ch == '*' and nxt == '/':
                state = 'code'
                i += 2
            else:
                if ch == '\n':
                    out.append(ch)
                i += 1
        else:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == state:
                state = 'code'
            out.append(ch)
            i += 1
    return ''.join(out)


def strip_css_comments(text: str) -> str:
    out = []
    i = 0
    state = 'code'
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if state == 'code':
            if ch == '/' and nxt == '*':
                state = 'block_comment'
                i += 2
            else:
                out.append(ch)
                i += 1
        else:
            if ch == '*' and nxt == '/':
                state = 'code'
                i += 2
            else:
                if ch == '\n':
                    out.append(ch)
                i += 1
    return ''.join(out)


def strip_html_comments(text: str) -> str:
    out = []
    i = 0
    while i < len(text):
        if text.startswith('<!--', i):
            end = text.find('-->', i + 4)
            if end == -1:
                break
            i = end + 3
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)


def process_text(path: Path, text: str) -> str:
    if path.suffix.lower() == '.css':
        return strip_css_comments(text)
    if path.suffix.lower() in {'.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'}:
        return strip_js_comments(text)
    if path.suffix.lower() == '.html':
        text = strip_html_comments(text)
        result = []
        i = 0
        while i < len(text):
            lower = text.lower()
            script_start = lower.find('<script', i)
            style_start = lower.find('<style', i)
            if script_start == -1 and style_start == -1:
                result.append(text[i:])
                break
            if script_start != -1 and (style_start == -1 or script_start < style_start):
                result.append(text[i:script_start])
                tag_end = text.find('>', script_start)
                if tag_end == -1:
                    break
                result.append(text[script_start:tag_end + 1])
                close_tag = text.lower().find('</script>', tag_end + 1)
                if close_tag == -1:
                    break
                content = text[tag_end + 1:close_tag]
                result.append(strip_js_comments(content))
                result.append(text[close_tag:close_tag + 9])
                i = close_tag + 9
            else:
                result.append(text[i:style_start])
                tag_end = text.find('>', style_start)
                if tag_end == -1:
                    break
                result.append(text[style_start:tag_end + 1])
                close_tag = text.lower().find('</style>', tag_end + 1)
                if close_tag == -1:
                    break
                content = text[tag_end + 1:close_tag]
                result.append(strip_css_comments(content))
                result.append(text[close_tag:close_tag + 8])
                i = close_tag + 8
        return ''.join(result)
    return text

changed = 0
for path in root.rglob('*'):
    if not path.is_file():
        continue
    if path.suffix.lower() not in exts:
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except Exception:
        continue
    new_text = process_text(path, text)
    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        changed += 1

print(f'updated {changed} files')
