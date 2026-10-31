import { questionFromAskUserInput } from "../../../../src/daemon/agents/claude/question.js";

describe("questionFromAskUserInput", () => {
  it("maps the first question, stripping (Recommended) case-insensitively", () => {
    expect(
      questionFromAskUserInput("t1", {
        questions: [
          {
            question: "Pick?",
            multiSelect: true,
            options: [
              { label: "A (recommended)", description: "d" },
              { label: "B" },
              { nolabel: 1 },
            ],
          },
          { question: "ignored" },
        ],
      }),
    ).toEqual({
      kind: "question",
      id: "t1",
      text: "Pick?",
      multiSelect: true,
      allowsText: true,
      options: [{ label: "A", description: "d", recommended: true }, { label: "B" }],
    });
  });

  it.each([undefined, null, "x", {}, { questions: [] }, { questions: [{ question: 3 }] }])(
    "returns undefined for malformed input %j",
    (input) => expect(questionFromAskUserInput("t", input)).toBeUndefined(),
  );
});
