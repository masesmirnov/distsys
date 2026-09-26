function escapeHtml(text) {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

export function highlight(line, grammar) {
  const tokens = /("[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let html = '';
  let last = 0;
  let previous = '';
  for (const match of line.matchAll(tokens)) {
    html += escapeHtml(line.slice(last, match.index));
    const token = match[0];
    let kind = null;
    if (token[0] === '"' || token[0] === "'") kind = 'tok-s';
    else if (/^\d/.test(token)) kind = 'tok-n';
    else if (grammar.keywords.has(token)) kind = 'tok-k';
    else if (grammar.definers.has(previous)) kind = 'tok-f';
    else if (grammar.builtins.has(token)) kind = 'tok-b';
    html += kind ? `<span class="${kind}">${escapeHtml(token)}</span>` : escapeHtml(token);
    if (/^[A-Za-z_]/.test(token)) previous = token;
    last = match.index + token.length;
  }
  return html + escapeHtml(line.slice(last));
}

export function element(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export const ICON = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
