// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReviewStage, type ReviewStageProps } from "../ReviewStage";

afterEach(cleanup);
const props: ReviewStageProps = {
  voided: false,
  reveal: {
    index: 0, mode: "multiple_choice", options: ["Paris", "Rome", "Oslo"],
    correct_option: 0, accepted_variants: null, correction: null,
    explanation: "Paris is home to the Eiffel Tower.",
  },
  distribution: null, isHost: false, canChallenge: false, challenging: false,
  challengeError: null, showAnswerDispute: false, onChallenge: vi.fn(),
};
describe("review explanations", () => {
  it.each([true, false])("shows the fact under the answer, host=%s", (isHost) => {
    render(<ReviewStage {...props} isHost={isHost} />);
    const answer = screen.getByText("Correct answer:");
    const fact = screen.getByRole("complementary", { name: "Did you know?" });
    expect(fact.textContent).toContain(props.reveal!.explanation);
    expect(answer.compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it.each([null, undefined, ""])("omits empty enrichment %s", (explanation) => {
    render(<ReviewStage {...props} reveal={{ ...props.reveal!, explanation }} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("waits for the answer reveal", () => {
    render(<ReviewStage {...props} reveal={null} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("hides potentially misleading facts after a correction while retaining the correction", () => {
    render(<ReviewStage {...props} reveal={{ ...props.reveal!, correction: "The question should have asked about Rome." }} />);
    expect(screen.getByText("The question should have asked about Rome.")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("hides facts for voided questions", () => {
    render(<ReviewStage {...props} voided />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
