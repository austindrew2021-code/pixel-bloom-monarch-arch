/** f3: the "who cooks tonight" chip. The first chip is the user: "You cook", not "You cooks". */
export const SELF_COOK = "You";

export function cooksLabel(name: string): string {
  return name === SELF_COOK ? "You cook" : `${name} cooks`;
}
