// Just enough DOM to execute the dashboard's inline script in Node and catch
// runtime errors. Not a renderer: it records the tree, nothing more.
import vm from 'node:vm';

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._text = '';
    this.innerHTML = '';
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  querySelector() {
    return null;
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  get offsetWidth() {
    return 100;
  }
  get offsetHeight() {
    return 20;
  }
}

export function runDashboardScript(html) {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const byId = { app: new Node('div'), tip: new Node('div') };
  const document = {
    createElement: (t) => new Node(t),
    createElementNS: (_, t) => new Node(t),
    getElementById: (id) => byId[id],
    addEventListener() {},
  };
  const ctx = { document, navigator: {}, innerWidth: 1200, innerHeight: 800, console, Math, JSON, Date, String, Number, Object, Array, Set, Map, setTimeout };
  vm.runInNewContext(script, ctx, { timeout: 2000 });
  return byId.app;
}

export function countTags(node, tag, acc = { n: 0 }) {
  if (node.tagName === tag) acc.n++;
  for (const c of node.children || []) countTags(c, tag, acc);
  return acc.n;
}
