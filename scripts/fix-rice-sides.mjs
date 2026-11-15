#!/usr/bin/env node
/** Add rice/couscous to wired titles whose steps name them but the list does not. */
import { readFileSync, writeFileSync } from "node:fs";

const files = [
  "src/lib/catalog-more.ts",
  "src/lib/catalog-plus.ts",
  "src/lib/catalog-expand.ts",
];

const RICE = `, I("rice", 1.5, "cups", "Pantry")`;
const COUS = `, I("couscous", 1.5, "cups", "Pantry")`;

function hasIng(line, word) {
  const re = new RegExp(`I\\("[^"]*${word}[^"]*"`, "i");
  return re.test(line);
}

function inject(line, extra) {
  const idx = line.indexOf("], [");
  if (idx < 0) return line;
  return line.slice(0, idx) + extra + line.slice(idx);
}

let rice = 0;
let cous = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const out = src
    .split("\n")
    .map((line) => {
      if (!line.includes("x(") && !line.includes("so(")) return line;
      let next = line;
      if (/\bRice\./.test(next) && !hasIng(next, "rice")) {
        next = inject(next, RICE);
        rice += 1;
      }
      if (/\bCouscous\./.test(next) && !hasIng(next, "couscous")) {
        next = inject(next, COUS);
        cous += 1;
      }
      return next;
    })
    .join("\n");
  if (out !== src) writeFileSync(file, out);
}
console.log(`rice ${rice} couscous ${cous}`);
