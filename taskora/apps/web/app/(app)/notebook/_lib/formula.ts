/**
 * Lightweight formula + inline-math evaluator.
 *
 * Two surfaces:
 *   1. evaluateExpression(expr)            — pure arithmetic, no cells
 *   2. evaluateCellFormula(expr, cellMap)  — arithmetic + cell refs + SUM/AVG
 *
 * Hand-rolled recursive-descent parser so we don't ship 30KB of
 * formulajs for a v1 that uses < 1% of it. Adds <300 lines of code.
 *
 * Grammar (cell formulas):
 *   expr     := term (('+' | '-') term)*
 *   term     := unary (('*' | '/' | '%') unary)*
 *   unary    := ('-' | '+')? primary
 *   primary  := NUMBER | CELLREF | FUNC '(' arglist ')' | '(' expr ')'
 *   arglist  := arg (',' arg)*
 *   arg      := expr | RANGE                  // RANGE only inside SUM/AVG
 *
 * Errors render as:
 *   #DIV/0!  — division by zero
 *   #ERR!    — parse error or invalid ref
 *   #CYCLE!  — circular reference (cell formulas only)
 */

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; error: "DIV/0" | "ERR" | "CYCLE" };

export function evaluateExpression(expr: string): EvalResult {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const ctx = { cells: undefined, visiting: new Set<string>() };
    const v = parser.parseExpr(ctx);
    parser.expectEnd();
    if (!Number.isFinite(v)) return { ok: false, error: "ERR" };
    return { ok: true, value: v };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "DIV/0" || code === "CYCLE") return { ok: false, error: code };
    return { ok: false, error: "ERR" };
  }
}

export type CellMap = Map<string, string>;  // "A1" -> raw cell content (literal or formula starting with '=')

export function evaluateCellFormula(raw: string, cells: CellMap): EvalResult {
  try {
    const ctx: Ctx = { cells, visiting: new Set<string>() };
    const tokens = tokenize(stripLeadingEquals(raw));
    const parser = new Parser(tokens);
    const v = parser.parseExpr(ctx);
    parser.expectEnd();
    if (!Number.isFinite(v)) return { ok: false, error: "ERR" };
    return { ok: true, value: v };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "DIV/0" || code === "CYCLE") return { ok: false, error: code };
    return { ok: false, error: "ERR" };
  }
}

/**
 * Render the value of a cell whose raw content may be a literal or a
 * formula. Empty cells return 0 (Excel behavior).
 */
export function evaluateCell(cellRef: string, cells: CellMap, ctx?: Ctx): number {
  const raw = (cells.get(cellRef) ?? "").trim();
  if (!raw) return 0;
  if (!raw.startsWith("=")) {
    // Literal — parse as number; non-numeric text contributes 0.
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  const c = ctx ?? { cells, visiting: new Set<string>() };
  if (c.visiting.has(cellRef)) {
    const err = new Error("CYCLE") as Error & { code: string };
    err.code = "CYCLE";
    throw err;
  }
  c.visiting.add(cellRef);
  try {
    const tokens = tokenize(stripLeadingEquals(raw));
    const parser = new Parser(tokens);
    const v = parser.parseExpr(c);
    parser.expectEnd();
    if (!Number.isFinite(v)) {
      const err = new Error("ERR") as Error & { code: string };
      err.code = "ERR";
      throw err;
    }
    return v;
  } finally {
    c.visiting.delete(cellRef);
  }
}

// ── A pure-math line is one that contains only digits, decimal points,
// operators (+ - * / %), parens, and whitespace. We use this to power
// the auto-evaluate behavior on standalone lines in the page editor.
const PURE_MATH_LINE = /^[\s\d.+\-*/%()]+$/;
export function looksLikePureMath(line: string): boolean {
  if (!line.trim()) return false;
  if (!PURE_MATH_LINE.test(line)) return false;
  // Require at least one operator so we don't auto-render bare numbers.
  return /[+\-*/%]/.test(line);
}

// Roughly true when the text contains *something* the renderer will
// evaluate — used to gate the live-preview affordance in edit mode.
export function hasInlineMath(text: string): boolean {
  for (const line of text.split("\n")) {
    if (looksLikePureMath(line)) return true;
    // =<number-or-paren> opens an inline expression.
    if (/=[\d(]/.test(line)) return true;
  }
  return false;
}

// ── Internal types + lexer/parser ─────────────────────────────────────

type Ctx = { cells: CellMap | undefined; visiting: Set<string> };

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "%" }
  | { kind: "lparen" } | { kind: "rparen" }
  | { kind: "comma" } | { kind: "colon" }
  | { kind: "ident"; value: string }      // function name or cell ref like A1
  | { kind: "end" };

function stripLeadingEquals(s: string): string {
  return s.startsWith("=") ? s.slice(1) : s;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // Skip ALL whitespace (was only ' ' and '\t' — broke multi-line cells
    // and any expression that contained \n / \r / form-feed).
    if (/\s/.test(c)) { i++; continue; }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i + 1;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) bail();
      out.push({ kind: "num", value: n });
      i = j; continue;
    }
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      out.push({ kind: "ident", value: src.slice(i, j).toUpperCase() });
      i = j; continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%") {
      out.push({ kind: "op", value: c as "+" | "-" | "*" | "/" | "%" });
      i++; continue;
    }
    if (c === "(") { out.push({ kind: "lparen" }); i++; continue; }
    if (c === ")") { out.push({ kind: "rparen" }); i++; continue; }
    if (c === ",") { out.push({ kind: "comma" }); i++; continue; }
    if (c === ":") { out.push({ kind: "colon" }); i++; continue; }
    bail();
  }
  out.push({ kind: "end" });
  return out;
}

function bail(): never {
  const e = new Error("ERR") as Error & { code: string };
  e.code = "ERR";
  throw e;
}

class Parser {
  i = 0;
  ctx: Ctx | null = null;
  constructor(public toks: Token[]) {}
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  expectEnd() { if (this.peek().kind !== "end") bail(); }

  parseExpr(ctx: Ctx): number {
    this.ctx = ctx;
    let v = this.parseTerm(ctx);
    while (true) {
      const t = this.peek();
      if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const rhs = this.parseTerm(ctx);
        v = t.value === "+" ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  }

  parseTerm(ctx: Ctx): number {
    let v = this.parseUnary(ctx);
    while (true) {
      const t = this.peek();
      if (t.kind === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
        this.next();
        const rhs = this.parseUnary(ctx);
        if ((t.value === "/" || t.value === "%") && rhs === 0) {
          const e = new Error("DIV/0") as Error & { code: string };
          e.code = "DIV/0";
          throw e;
        }
        v = t.value === "*" ? v * rhs : t.value === "/" ? v / rhs : v % rhs;
      } else break;
    }
    return v;
  }

  parseUnary(ctx: Ctx): number {
    const t = this.peek();
    if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const v = this.parseUnary(ctx);
      return t.value === "-" ? -v : v;
    }
    return this.parsePrimary(ctx);
  }

  parsePrimary(ctx: Ctx): number {
    const t = this.next();
    if (t.kind === "num") return t.value;
    if (t.kind === "lparen") {
      const v = this.parseExpr(ctx);
      const close = this.next();
      if (close.kind !== "rparen") bail();
      return v;
    }
    if (t.kind === "ident") {
      // Either a function call or a cell ref.
      if (this.peek().kind === "lparen") {
        this.next();  // consume (
        const args = this.parseArgs(ctx);
        const close = this.next();
        if (close.kind !== "rparen") bail();
        return this.applyFunction(t.value, args);
      }
      // Cell ref like A1 / B23.
      if (!ctx.cells) bail();
      if (!/^[A-Z]+\d+$/.test(t.value)) bail();
      return evaluateCell(t.value, ctx.cells, ctx);
    }
    bail();
  }

  parseArgs(ctx: Ctx): { kind: "expr"; value: number }[] | { kind: "range"; ref: [string, string] }[] {
    // Heuristic: if the next two tokens are ident, colon, ident, it's a range.
    // Otherwise treat each comma-separated chunk as an expression.
    const args: any[] = [];
    while (this.peek().kind !== "rparen") {
      const start = this.i;
      const a = this.peek();
      const b = this.toks[this.i + 1];
      const c = this.toks[this.i + 2];
      if (
        a.kind === "ident" && b && b.kind === "colon" && c && c.kind === "ident"
        && /^[A-Z]+\d+$/.test(a.value) && /^[A-Z]+\d+$/.test(c.value)
      ) {
        args.push({ kind: "range", ref: [a.value, c.value] });
        this.i += 3;
      } else {
        const v = this.parseExpr(ctx);
        args.push({ kind: "expr", value: v });
      }
      if (this.peek().kind === "comma") { this.next(); continue; }
      break;
    }
    return args;
  }

  applyFunction(name: string, args: any[]): number {
    if (name === "SUM") return this.foldRange(args, (acc, v) => acc + v, 0);
    if (name === "AVG" || name === "AVERAGE") {
      let total = 0; let count = 0;
      for (const a of args) {
        const vs = this.expandArg(a);
        for (const v of vs) { total += v; count++; }
      }
      if (count === 0) {
        const e = new Error("DIV/0") as Error & { code: string };
        e.code = "DIV/0";
        throw e;
      }
      return total / count;
    }
    bail();
  }

  foldRange(args: any[], fn: (acc: number, v: number) => number, init: number): number {
    let acc = init;
    for (const a of args) for (const v of this.expandArg(a)) acc = fn(acc, v);
    return acc;
  }

  expandArg(a: any): number[] {
    if (a.kind === "expr") return [a.value];
    if (!this.ctx || !this.ctx.cells) bail();
    const [from, to] = a.ref as [string, string];
    return this.rangeValues(from, to);
  }

  rangeValues(from: string, to: string): number[] {
    const m1 = /^([A-Z]+)(\d+)$/.exec(from);
    const m2 = /^([A-Z]+)(\d+)$/.exec(to);
    if (!m1 || !m2) bail();
    const [c1, r1] = [colToInt(m1[1]), Number(m1[2])];
    const [c2, r2] = [colToInt(m2[1]), Number(m2[2])];
    const [cMin, cMax] = [Math.min(c1, c2), Math.max(c1, c2)];
    const [rMin, rMax] = [Math.min(r1, r2), Math.max(r1, r2)];
    const out: number[] = [];
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        out.push(evaluateCell(`${intToCol(c)}${r}`, this.ctx!.cells!, this.ctx!));
      }
    }
    return out;
  }
}

function colToInt(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function intToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
