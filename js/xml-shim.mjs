// Minimal, dependency-free DOMParser + XMLSerializer stand-ins used ONLY by
// this workstream's tests (js/backup.test.mjs, js/svg-ingest.test.mjs) to
// exercise js/svg-ingest.js's ingestSvg() — the one public entry point that
// touches the browser-global DOMParser/XMLSerializer APIs, which don't exist
// under `node --test`. Not part of the app; not imported by any source
// module. Deliberately tiny: it supports exactly the SVG shapes these tests
// construct (well-formed tags, double-quoted attributes, optional text
// content for <style> blocks) — it is NOT a general XML parser.
//
// Installed as globalThis.DOMParser / globalThis.XMLSerializer only if not
// already present, mirroring test-helpers.mjs's guarded-install convention.

class XmlNode {
  constructor(tagName) {
    this.tagName = tagName;
    this._attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this._text = "";
  }

  get attributes() {
    return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }));
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }

  hasAttribute(name) {
    return this._attrs.has(name);
  }

  removeAttribute(name) {
    this._attrs.delete(name);
  }

  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this._text = value;
  }

  querySelectorAll(tagName) {
    const out = [];
    const visit = (el) => {
      for (const child of el.children) {
        if (child.tagName.toLowerCase() === tagName.toLowerCase()) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
}

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)\s*>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function parseXml(text) {
  TAG_RE.lastIndex = 0;
  let root = null;
  const stack = [];
  let lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    // Any plain text between the previous tag and this one (e.g. a
    // <style>...</style> body) belongs to the currently-open element.
    const between = text.slice(lastIndex, m.index);
    if (between && stack.length > 0) {
      stack[stack.length - 1]._text += between;
    }
    lastIndex = TAG_RE.lastIndex;

    const [, closing, tagName, attrStr] = m;
    const selfClose = m[4] === "/";
    if (closing) {
      stack.pop();
      continue;
    }
    const node = new XmlNode(tagName);
    ATTR_RE.lastIndex = 0;
    let am;
    while ((am = ATTR_RE.exec(attrStr))) {
      node.setAttribute(am[1], am[2]);
    }
    if (stack.length > 0) {
      node.parentNode = stack[stack.length - 1];
      stack[stack.length - 1].children.push(node);
    } else {
      root = node;
    }
    if (!selfClose) stack.push(node);
  }
  return root;
}

function serializeNode(el) {
  const attrs = el.attributes.map((a) => ` ${a.name}="${a.value}"`).join("");
  if (el.children.length === 0 && !el._text) {
    return `<${el.tagName}${attrs}/>`;
  }
  const inner = el.children.map(serializeNode).join("") + (el._text || "");
  return `<${el.tagName}${attrs}>${inner}</${el.tagName}>`;
}

class FakeDOMParser {
  parseFromString(text) {
    const root = parseXml(String(text));
    return {
      documentElement: root,
      // Our tokenizer never produces a parsererror node — malformed input
      // just yields root === null, which ingestSvg's own `!root` check
      // already turns into a user-facing error.
      querySelector: () => null,
    };
  }
}

class FakeXMLSerializer {
  serializeToString(el) {
    return serializeNode(el);
  }
}

if (!globalThis.DOMParser) {
  globalThis.DOMParser = FakeDOMParser;
}
if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = FakeXMLSerializer;
}
