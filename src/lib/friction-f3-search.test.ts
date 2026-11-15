import assert from "node:assert/strict";
import test from "node:test";
import { RECIPES } from "./recipes.ts";
import { recipeSearchTier, searchRecipes, searchRecipesTab } from "./search.ts";

// f3 r2 item 5: whole words decide the order only; matches are never fewer than the old search.
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

for (const [q, main] of [["chic", 490], ["chick", 487], ["berry", 129], ["short ribs", 214]] as const) {
  test(`5: "${q}" returns at least as many as main (${main}) and every old match`, () => {
    const tab = searchRecipesTab(q, RECIPES);
    const old = searchRecipes(q, RECIPES);
    assert.ok(tab.length >= main, `${tab.length} < ${main}`);
    assert.ok(tab.length >= old.length);
    const ids = new Set(tab.map((r) => r.id));
    for (const r of old) assert.ok(ids.has(r.id), `old match ${r.id} missing`);
  });
}

test("5: 'chic' / 'chick' (typing) lead with chicken names", () => {
  for (const q of ["chic", "chick"]) {
    const top = searchRecipesTab(q, RECIPES).slice(0, 10);
    assert.ok(top.every((r) => /\bchick/i.test(r.name)), `${q}: ${top.map((r) => r.name).join(", ")}`);
  }
});

test("5: 'berry' includes Blueberry and Strawberry; berry/berries fold", () => {
  const names = searchRecipesTab("berry", RECIPES).map((r) => r.name.toLowerCase());
  assert.ok(names.some((n) => n.includes("blueberr")));
  assert.ok(names.some((n) => n.includes("strawberr")));
  const tierOf = recipeSearchTier("berry");
  const berries = RECIPES.find((r) => /\bberries\b/i.test(r.name));
  if (berries) assert.ok((tierOf(berries) ?? 99) <= 2, "a 'berries' name is a name-word match for 'berry'");
});

test("5: 'Chicken a la king' top hit is a chicken à la king (accents fold)", () => {
  for (const q of ["Chicken a la king", "chicken a la king"]) {
    const top = searchRecipesTab(q, RECIPES)[0]!;
    assert.equal(fold(top.name), "chicken a la king");
  }
  const accented = RECIPES.find((r) => r.name === "Chicken à la king");
  if (accented) assert.equal(recipeSearchTier("Chicken a la king")(accented), 0);
});

test("5: 'prime rib' puts hd-prime-rib first", () => {
  assert.equal(searchRecipesTab("prime rib", RECIPES)[0]?.id, "hd-prime-rib");
  assert.equal(searchRecipesTab("Prime Rib ", RECIPES)[0]?.id, "hd-prime-rib");
});

test("5: 'rib': whole-word and plural matches rank above substring-only Caribbean", () => {
  const r = searchRecipesTab("rib", RECIPES);
  const tierOf = recipeSearchTier("rib");
  const firstSub = r.findIndex((x) => tierOf(x) === 9);
  const lastWord = r.map((x) => tierOf(x)).lastIndexOf(1);
  assert.ok(firstSub === -1 || lastWord < firstSub);
  const ribs = r.filter((x) => /\bribs\b/i.test(x.name));
  assert.ok(ribs.length > 0 && ribs.every((x) => (tierOf(x) ?? 99) <= 2), "'ribs' names fold to 'rib'");
  assert.equal(searchRecipesTab("ribs", RECIPES).findIndex((x) => x.id === "hd-prime-rib") >= 0, true, "ribs finds Holiday prime rib");
});

test("5: tiers with fakes: exact, phrase, words, prefix, anywhere, substring", () => {
  const fake = (name: string, extra = "") => ({ name, description: extra, cuisine: "", tags: [], aliases: [], ingredients: [] }) as never;
  const tierOf = recipeSearchTier("prime rib");
  assert.equal(tierOf(fake("Prime rib")), 0);
  assert.equal(tierOf(fake("Holiday prime rib")), 1);
  assert.equal(tierOf(fake("Rib roast, prime cut")), 2);
  assert.equal(tierOf(fake("Holiday prime ribeye")), 4);
  assert.equal(tierOf(fake("Sunday roast", "a prime rib dinner")), 6);
  assert.equal(tierOf(fake("Caribbean stew", "prime")), 8);
  assert.equal(tierOf(fake("Caribbean stew")), 9);
  assert.equal(tierOf(fake("Lentil soup")), null);
  assert.equal(recipeSearchTier("prime rib ")(fake("Holiday prime ribeye")), 8, "trailing space: last word is finished, no prefix");
});

test("5: Plan picker search (searchRecipes) unchanged: hd-prime-rib still first", () => {
  assert.equal(searchRecipes("prime rib", RECIPES)[0]?.id, "hd-prime-rib");
});
