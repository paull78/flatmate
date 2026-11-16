import { useEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  onCommit(value: string): void;
  "data-testid"?: string;
};

/**
 * A local draft; commits a changed value on blur (Enter blurs), Escape restores without committing. After a
 * commit the draft goes back to `value`: an accepted edit then shows the new value, a refused one the old.
 */
export function DraftInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      {...rest}
      data-draft=""
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
        setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  onCommit(value: string): void;
};

/**
 * A multi-line draft (the project notes, sheet.05): Enter is a new line; it commits a changed value on blur or
 * Ctrl/Cmd+Enter, and Escape restores without committing, like DraftInput.
 */
export function DraftTextArea({ value, onCommit, ...rest }: AreaProps) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <textarea
      {...rest}
      data-draft=""
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
        setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
