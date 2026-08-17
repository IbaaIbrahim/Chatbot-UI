import * as React from 'react';
import './QuestionnaireForm.css';

export type QuestionType = 'single_choice' | 'multi_choice' | 'text';

/** A single question as sent by the agent via the ``ask_user_questions`` tool. */
export interface QuestionSpec {
    question: string;
    type: QuestionType;
    /** Choices for single_choice / multi_choice. Ignored for text. */
    options?: string[];
    allow_other?: boolean;
}

export interface QuestionnaireFormProps {
    questions: QuestionSpec[];
    /**
     * Called once when the user submits. ``formatted`` is the ready-to-send
     * "Q1/A1, Q2/A2 …" block that becomes the tool result for the agent.
     */
    onSubmit: (formatted: string) => void;
}

/** Per-question answer state. */
interface AnswerState {
    /** Selected regular option labels (single_choice keeps at most one). */
    selected: string[];
    /** Whether the auto-appended "Other" option is chosen. */
    otherSelected: boolean;
    /** Free text for the "Other" option. */
    otherText: string;
    /** Free text for a ``text`` question. */
    text: string;
}

function emptyAnswer(): AnswerState {
    return { selected: [], otherSelected: false, otherText: '', text: '' };
}

function isAnswered(question: QuestionSpec, answer: AnswerState): boolean {
    if (question.type === 'text') {
        return answer.text.trim().length > 0;
    }
    // For choice types, an "Other" selection only counts once it has text.
    const hasOther = question.allow_other !== false && answer.otherSelected && answer.otherText.trim().length > 0;
    if (question.allow_other !== false && answer.otherSelected && answer.otherText.trim().length === 0) {
        return false;
    }
    return answer.selected.length > 0 || hasOther;
}

/** Render one question's answer as a human-readable string. */
function formatAnswer(question: QuestionSpec, answer: AnswerState): string {
    if (question.type === 'text') {
        return answer.text.trim();
    }
    const parts = [...answer.selected];
    if (answer.otherSelected && answer.otherText.trim().length > 0) {
        parts.push(answer.otherText.trim());
    }
    return parts.join(', ');
}

/** Build the "Q1/A1 …" block returned to the agent. */
export function formatAnswers(questions: QuestionSpec[], answers: AnswerState[]): string {
    return questions
        .map((question, index) => {
            const answer = answers[index] ?? emptyAnswer();
            return `Q${index + 1}: ${question.question}\nA${index + 1}: ${formatAnswer(question, answer)}`;
        })
        .join('\n');
}

const OTHER_LABEL = 'Other';

export const QuestionnaireForm: React.FC<QuestionnaireFormProps> = ({ questions, onSubmit }) => {
    const [current, setCurrent] = React.useState(0);
    const [answers, setAnswers] = React.useState<AnswerState[]>(() =>
        questions.map(() => emptyAnswer())
    );
    const [submitted, setSubmitted] = React.useState(false);

    // Reset when a new questionnaire is shown.
    React.useEffect(() => {
        setCurrent(0);
        setAnswers(questions.map(() => emptyAnswer()));
        setSubmitted(false);
    }, [questions]);

    if (questions.length === 0) return null;

    const total = questions.length;
    const question = questions[current];
    const answer = answers[current] ?? emptyAnswer();
    const isLast = current === total - 1;
    const currentAnswered = isAnswered(question, answer);
    const allAnswered = questions.every((q, i) => isAnswered(q, answers[i] ?? emptyAnswer()));

    const updateAnswer = (patch: Partial<AnswerState>) => {
        setAnswers(prev =>
            prev.map((a, i) => (i === current ? { ...a, ...patch } : a))
        );
    };

    const toggleOption = (option: string) => {
        if (question.type === 'single_choice') {
            updateAnswer({ selected: [option], otherSelected: false });
        } else {
            const has = answer.selected.includes(option);
            updateAnswer({
                selected: has
                    ? answer.selected.filter(o => o !== option)
                    : [...answer.selected, option],
            });
        }
    };

    const selectOther = () => {
        if (question.type === 'single_choice') {
            updateAnswer({ selected: [], otherSelected: true });
        } else {
            updateAnswer({ otherSelected: !answer.otherSelected });
        }
    };

    const handleSubmit = () => {
        if (!allAnswered || submitted) return;
        setSubmitted(true);
        onSubmit(formatAnswers(questions, answers));
    };

    const options = question.options ?? [];
    const inputType = question.type === 'single_choice' ? 'radio' : 'checkbox';

    return (
        <div className="cb-questionnaire">
            <div className="cb-questionnaire-question">{question.question}</div>

            <div className="cb-questionnaire-body">
                {question.type === 'text' ? (
                    <textarea
                        className="cb-questionnaire-textarea"
                        value={answer.text}
                        placeholder="Type your answer…"
                        rows={3}
                        autoFocus
                        onChange={e => updateAnswer({ text: e.target.value })}
                    />
                ) : (
                    <div className="cb-questionnaire-options" role={question.type === 'single_choice' ? 'radiogroup' : 'group'}>
                        {options.map(option => {
                            const checked = answer.selected.includes(option);
                            return (
                                <label
                                    key={option}
                                    className={`cb-questionnaire-option ${checked ? 'checked' : ''}`}
                                >
                                    <input
                                        type={inputType}
                                        checked={checked}
                                        onChange={() => toggleOption(option)}
                                    />
                                    <span>{option}</span>
                                </label>
                            );
                        })}

                        {/* The "Other" option is always appended for choice questions. */}
                        {question.allow_other !== false && (
                            <>
                                <label className={`cb-questionnaire-option ${answer.otherSelected ? 'checked' : ''}`}>
                                    <input
                                        type={inputType}
                                        checked={answer.otherSelected}
                                        onChange={selectOther}
                                    />
                                    <span>{OTHER_LABEL}</span>
                                </label>
                                {answer.otherSelected && (
                                    <input
                                        className="cb-questionnaire-other-input"
                                        type="text"
                                        value={answer.otherText}
                                        placeholder="Enter custom answer"
                                        autoFocus
                                        onChange={e => updateAnswer({ otherText: e.target.value })}
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="cb-questionnaire-footer">
                <button
                    type="button"
                    className="cb-questionnaire-nav"
                    disabled={current === 0}
                    aria-label="Previous question"
                    onClick={() => setCurrent(c => Math.max(0, c - 1))}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>

                <span className="cb-questionnaire-counter">{current + 1} / {total}</span>

                {isLast ? (
                    <button
                        type="button"
                        className="cb-questionnaire-submit"
                        disabled={!allAnswered || submitted}
                        onClick={handleSubmit}
                    >
                        {submitted ? 'Submitted' : 'Submit'}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="cb-questionnaire-nav"
                        disabled={!currentAnswered}
                        aria-label="Next question"
                        onClick={() => setCurrent(c => Math.min(total - 1, c + 1))}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};
