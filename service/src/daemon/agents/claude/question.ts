import type { Pending } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";

const RECOMMENDED = /\s*\(recommended\)\s*/i;

type QuestionPending = Extract<Pending, { kind: "question" }>;
type QuestionOption = QuestionPending["options"][number];

/**
 * The pending question of an AskUserQuestion call (its first question), or undefined when the
 * tool input is not well formed. Shared by the transcript normaliser and the hook mapper so a
 * question looks the same whichever source reports it first.
 */
export function questionFromAskUserInput(
  toolUseId: string,
  input: unknown,
): QuestionPending | undefined {
  if (!isRecord(input) || !Array.isArray(input.questions)) return undefined;
  const question: unknown = input.questions[0];
  if (!isRecord(question) || typeof question.question !== "string") return undefined;
  const options = Array.isArray(question.options) ? question.options.filter(isRecord) : [];
  return {
    kind: "question",
    id: toolUseId,
    text: question.question,
    multiSelect: question.multiSelect === true,
    allowsText: true, // Claude Code always offers a free-text "Other" answer
    options: options.flatMap(optionFrom),
  };
}

/** An option with "(Recommended)" moved from its label to the `recommended` flag. */
function optionFrom(option: Record<string, unknown>): QuestionOption[] {
  if (typeof option.label !== "string") return [];
  const recommended = RECOMMENDED.test(option.label);
  return [
    {
      label: recommended ? option.label.replace(RECOMMENDED, " ").trim() : option.label,
      ...(typeof option.description === "string" && { description: option.description }),
      ...(recommended && { recommended: true }),
    },
  ];
}
