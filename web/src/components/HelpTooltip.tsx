import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { HelpCopy } from "./physicsHelp";

export function HelpTooltip({
  copy,
  align = "start",
}: {
  copy: HelpCopy;
  align?: "start" | "end";
}) {
  const tooltipId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({
    left: 12,
    top: 12,
    above: false,
  });
  const visible = (pinned || hovered || focused) && !dismissed;

  const updatePosition = useCallback(() => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(320, window.innerWidth - 24);
    const preferredLeft = align === "end"
      ? bounds.right - width
      : bounds.left;
    setPosition({
      left: Math.max(
        12,
        Math.min(window.innerWidth - width - 12, preferredLeft),
      ),
      top:
        bounds.bottom + 172 < window.innerHeight
          ? bounds.bottom + 8
          : bounds.top - 8,
      above: bounds.bottom + 172 >= window.innerHeight,
    });
  }, [align]);

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition, visible]);

  return (
    <span
      className={[
        "help-tooltip",
        `align-${align}`,
        pinned ? "is-pinned" : "",
      ].filter(Boolean).join(" ")}
      onMouseEnter={() => {
        setDismissed(false);
        setHovered(true);
        updatePosition();
      }}
      onMouseLeave={() => setHovered(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          setPinned(false);
          setDismissed(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPinned(false);
          setDismissed(true);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="help-tooltip-trigger"
        aria-label={`Explain ${copy.label}`}
        aria-describedby={tooltipId}
        aria-expanded={pinned}
        onFocus={() => {
          setDismissed(false);
          setFocused(true);
          updatePosition();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setDismissed(pinned);
          setPinned(!pinned);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={tooltipId} role="tooltip" className="visually-hidden">
        {copy.label}. {copy.body} HofstadterTools convention.
      </span>
      {visible && createPortal(
        <span
          aria-hidden="true"
          className={[
            "help-tooltip-card",
            position.above ? "above" : "below",
          ].join(" ")}
          style={{ left: position.left, top: position.top }}
        >
        <strong>{copy.label}</strong>
        <span>{copy.body}</span>
        <small>HofstadterTools convention</small>
        </span>,
        document.body,
      )}
    </span>
  );
}
