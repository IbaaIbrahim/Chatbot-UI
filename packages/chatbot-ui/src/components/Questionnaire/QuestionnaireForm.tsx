import * as React from 'react';
import './QuestionnaireForm.css';
import { useLabels } from '../../store/hooks';

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

let formCount = 0;

export const QuestionnaireForm: React.FC<QuestionnaireFormProps> = ({ questions, onSubmit }) => {
    const labels = useLabels();
    // Names this form's radio groups and labels its options with the question.
    // A counter rather than `useId`, which React 17 hosts do not have.
    const formIdRef = React.useRef('');
    if (!formIdRef.current) {
        formCount += 1;
        formIdRef.current = `cb-questionnaire-${formCount}`;
    }
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

    const goToNext = () => setCurrent(c => Math.min(total - 1, c + 1));

    // Enter answers from a text field the way it sends from the composer;
    // Shift+Enter is a new line, and Enter that commits an IME composition is
    // the composition's, not the form's.
    const handleAnswerKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (isLast) {
            handleSubmit();
        } else if (currentAnswered) {
            goToNext();
        }
    };

    const options = question.options ?? [];
    const inputType = question.type === 'single_choice' ? 'radio' : 'checkbox';
    const questionId = `${formIdRef.current}-question-${current}`;
    // One name per question, so the browser treats its radios as one group:
    // arrow keys move the choice and Tab enters and leaves the group once.
    const groupName = `${formIdRef.current}-answer-${current}`;

    return (
        <div className="cb-questionnaire">
            <div className="cb-questionnaire-header">
                <div className="cb-questionnaire-question" id={questionId}>{question.question}</div>
                {/* A pager for one question is two controls that do nothing. */}
                {total > 1 && <span className="cb-questionnaire-counter">{current + 1} / {total}</span>}
            </div>

            <div className="cb-questionnaire-body">
                {question.type === 'text' ? (
                    <textarea
                        className="cb-questionnaire-textarea"
                        value={answer.text}
                        placeholder={labels.answerPlaceholder}
                        aria-labelledby={questionId}
                        rows={2}
                        autoFocus
                        onChange={e => updateAnswer({ text: e.target.value })}
                        onKeyDown={handleAnswerKeyDown}
                    />
                ) : (
                    <div
                        className="cb-questionnaire-options"
                        role={question.type === 'single_choice' ? 'radiogroup' : 'group'}
                        aria-labelledby={questionId}
                    >
                        {options.map(option => {
                            const checked = answer.selected.includes(option);
                            return (
                                <label
                                    key={option}
                                    className={`cb-questionnaire-option ${checked ? 'checked' : ''}`}
                                >
                                    <input
                                        type={inputType}
                                        name={groupName}
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
                                        name={groupName}
                                        checked={answer.otherSelected}
                                        onChange={selectOther}
                                    />
                                    <span>{labels.otherOption}</span>
                                </label>
                                {answer.otherSelected && (
                                    <input
                                        className="cb-questionnaire-other-input"
                                        type="text"
                                        value={answer.otherText}
                                        placeholder={labels.customAnswerPlaceholder}
                                        aria-label={labels.otherOption}
                                        autoFocus
                                        onChange={e => updateAnswer({ otherText: e.target.value })}
                                        onKeyDown={handleAnswerKeyDown}
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="cb-questionnaire-footer">
                {current > 0 && (
                    <button
                        type="button"
                        className="cb-questionnaire-nav"
                        aria-label={labels.previousQuestion}
                        title={labels.previousQuestion}
                        onClick={() => setCurrent(c => Math.max(0, c - 1))}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                    </button>
                )}

                {isLast ? (
                    <button
                        type="button"
                        className="cb-questionnaire-submit"
                        disabled={!allAnswered || submitted}
                        onClick={handleSubmit}
                    >
                        {submitted ? labels.submitted : labels.submit}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="cb-questionnaire-submit cb-questionnaire-next"
                        disabled={!currentAnswered}
                        onClick={goToNext}
                    >
                        <span>{labels.nextQuestion}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};
