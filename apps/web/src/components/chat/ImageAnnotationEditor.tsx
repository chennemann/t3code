import { observeResize } from "~/lib/observeResize";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
  type ReactNode,
} from "react";
import { Trash2Icon, XIcon, ZoomInIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { randomUUID } from "../../lib/utils";
import { isContextMenuOpen } from "../../contextMenuFallback";
import {
  ANNOTATION_COLOR,
  annotationLabel,
  annotationRect,
  moveAnnotation,
  type AnnotationPoint,
  type ImageAnnotation,
} from "../../lib/imageAnnotations";

export interface ImageAnnotationResult {
  annotations: ImageAnnotation[];
  changed: boolean;
}
export interface ImageAnnotationEditorHandle {
  close: () => Promise<void>;
}
type Gesture = {
  pointerId: number;
  start: AnnotationPoint;
  before: ImageAnnotation[];
  id: string;
  kind: "draw" | "move" | "resize";
  anchor?: AnnotationPoint | undefined;
};
const EMPTY_PRIOR_MARKS: ReadonlyArray<ImageAnnotation> = [];

/** Draw on the standalone screenshot; its numbered comments float beside it. */
export function ImageAnnotationEditor({
  src,
  name,
  onApply,
  initialMarks,
  priorMarks = EMPTY_PRIOR_MARKS,
  onDraftChange,
  onBusyChange,
  onZoom,
  onDiscard,
  navigation,
  ref,
}: {
  src: string;
  name: string;
  onApply: (result: ImageAnnotationResult) => Promise<void>;
  initialMarks?: ReadonlyArray<ImageAnnotation> | undefined;
  priorMarks?: ReadonlyArray<ImageAnnotation>;
  onDraftChange: (marks: ImageAnnotation[]) => void;
  onBusyChange: (busy: boolean) => void;
  onZoom: () => void;
  onDiscard: () => void;
  navigation?: ReactNode;
  ref?: Ref<ImageAnnotationEditorHandle> | undefined;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const commentRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const gesture = useRef<Gesture | null>(null);
  const commentBefore = useRef<ImageAnnotation[] | null>(null);
  const savingRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [marks, setMarksState] = useState<ImageAnnotation[]>(() => [...(initialMarks ?? [])]);
  const setMarks = (
    update: ImageAnnotation[] | ((current: ImageAnnotation[]) => ImageAnnotation[]),
  ) => {
    const next = typeof update === "function" ? update(marks) : update;
    setMarksState(next);
    onDraftChange(next);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<ImageAnnotation[][]>([]);
  const [redo, setRedo] = useState<ImageAnnotation[][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const sideBySide = stageSize.width >= 900;
  // Reserve room from the start so the first circle cannot resize the image mid-drag.
  const maxWidth = sideBySide ? stageSize.width - 624 : stageSize.width;
  const maxHeight = sideBySide ? stageSize.height : Math.max(1, stageSize.height - 220);
  const fit = Math.min(maxWidth / (size.width || 1), maxHeight / (size.height || 1), 1);
  const record = (before: ImageAnnotation[]) => {
    setUndo((history) => [...history.slice(-49), before]);
    setRedo([]);
  };
  const focusComment = (id: string) => {
    setSelected(id);
    const field = commentRefs.current.get(id);
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "nearest" });
  };
  const removeSelected = () => {
    if (!selected) return;
    record(marks);
    setMarks(marks.filter((mark) => mark.id !== selected));
    setSelected(null);
  };

  // oxlint-disable-next-line t3code/react-effect-budget -- Observe the external stage dimensions and disconnect on unmount.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    return observeResize(stage, ([entry]) => {
      if (entry)
        setStageSize({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height),
        });
    });
  }, []);
  const point = (event: PointerEvent<SVGSVGElement>): AnnotationPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const finishGesture = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancel) {
      setMarks(active.before);
      return;
    }
    const end = point(event);
    const clicked =
      Math.hypot(
        (end.x - active.start.x) * size.width * fit,
        (end.y - active.start.y) * size.height * fit,
      ) < 5;
    if (active.kind !== "draw" && clicked) {
      setMarks(active.before);
      focusComment(active.id);
      return;
    }
    if (active.kind === "draw") {
      if (clicked)
        setMarks((current) =>
          current.map((mark) =>
            mark.id === active.id
              ? {
                  ...mark,
                  ...annotationRect(
                    { x: Math.max(0, end.x - 0.1), y: Math.max(0, end.y - 0.04) },
                    { x: Math.min(1, end.x + 0.1), y: Math.min(1, end.y + 0.04) },
                  ),
                }
              : mark,
          ),
        );
      requestAnimationFrame(() => focusComment(active.id));
    }
    record(active.before);
  };
  const close = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onApply({
        annotations: marks,
        changed: JSON.stringify(marks) !== JSON.stringify(initialMarks ?? []),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to attach annotations.");
    } finally {
      savingRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  useImperativeHandle(ref, () => ({ close }));

  return (
    <section
      ref={stageRef}
      aria-label="Image annotation editor"
      className="relative flex h-[var(--media-height)] w-full items-start justify-center text-white"
      aria-busy={busy}
      onClick={(event) => {
        if (event.target === event.currentTarget) void close();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (busy) return;
        if (event.key === "Escape" && !event.defaultPrevented && !isContextMenuOpen()) {
          event.preventDefault();
          void close();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          void close();
          return;
        }
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
        ) {
          event.preventDefault();
          const forwards = event.shiftKey || event.key.toLowerCase() === "y",
            next = (forwards ? redo : undo).at(-1);
          if (!next) return;
          if (forwards) {
            setUndo((history) => [...history, marks]);
            setRedo((history) => history.slice(0, -1));
          } else {
            setRedo((history) => [...history, marks]);
            setUndo((history) => history.slice(0, -1));
          }
          setMarks(next);
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          removeSelected();
        }
      }}
    >
      {navigation ? (
        <div className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2">{navigation}</div>
      ) : null}
      {!loaded && !error && <p className="self-center text-sm">Loading image…</p>}
      <div
        className="relative shrink-0"
        style={{ width: size.width * fit, marginTop: (maxHeight - size.height * fit) / 2 }}
      >
        <Button
          variant="media-close"
          size="icon-xs"
          aria-label="Zoom image"
          className="absolute right-10 -top-10 z-20"
          disabled={busy}
          onClick={onZoom}
        >
          <ZoomInIcon />
        </Button>
        <Button
          variant="media-close"
          size="icon-xs"
          aria-label="Close annotation editor"
          className="absolute right-0 -top-10 z-20"
          onClick={() => void close()}
          disabled={busy}
        >
          <XIcon />
        </Button>
        <div className="relative select-none" style={{ height: size.height * fit }}>
          <img
            ref={imageRef}
            src={src}
            alt={name}
            draggable={false}
            className="block h-full w-full"
            onLoad={(event) => {
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
              setLoaded(true);
            }}
            onError={() => setError("This image could not be opened for annotation.")}
          />
          {loaded && (
            <svg
              aria-label="Draw numbered ellipses on the image"
              className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
              viewBox={`0 0 ${size.width} ${size.height}`}
              onPointerDown={(event) => {
                if (busy || event.button !== 0 || gesture.current) return;
                const target =
                  event.target instanceof Element ? event.target.closest("[data-mark-id]") : null;
                const id = target?.getAttribute("data-mark-id"),
                  handle = target?.getAttribute("data-handle"),
                  start = point(event);
                const existing = marks.find((mark) => mark.id === id);
                if (existing) {
                  setSelected(existing.id);
                  const anchor = handle
                    ? {
                        x: handle.includes("w") ? existing.x + existing.width : existing.x,
                        y: handle.includes("n") ? existing.y + existing.height : existing.y,
                      }
                    : undefined;
                  gesture.current = {
                    pointerId: event.pointerId,
                    start,
                    before: marks,
                    id: existing.id,
                    kind: handle ? "resize" : "move",
                    anchor,
                  };
                } else {
                  if (marks.length + priorMarks.length >= 100) {
                    setError("An image can contain up to 100 annotations.");
                    return;
                  }
                  const nextId = randomUUID();
                  gesture.current = {
                    pointerId: event.pointerId,
                    start,
                    before: marks,
                    id: nextId,
                    kind: "draw",
                  };
                  setMarks([
                    ...marks,
                    { id: nextId, ...annotationRect(start, start), comment: "" },
                  ]);
                  setSelected(nextId);
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                const active = gesture.current;
                if (!active || active.pointerId !== event.pointerId) return;
                const end = point(event);
                setMarks((current) =>
                  current.map((mark) => {
                    if (mark.id !== active.id) return mark;
                    if (active.kind === "draw" || active.kind === "resize")
                      return { ...mark, ...annotationRect(active.anchor ?? active.start, end) };
                    const original = active.before.find((candidate) => candidate.id === active.id);
                    return original
                      ? moveAnnotation(original, {
                          x: end.x - active.start.x,
                          y: end.y - active.start.y,
                        })
                      : mark;
                  }),
                );
              }}
              onPointerUp={(event) => finishGesture(event)}
              onPointerCancel={(event) => finishGesture(event, true)}
            >
              {marks.map((mark, index) => {
                const label = annotationLabel(mark, size.width, size.height),
                  active = mark.id === selected;
                const x = mark.x * size.width,
                  y = mark.y * size.height,
                  width = mark.width * size.width,
                  height = mark.height * size.height,
                  handleSize = 9 / fit;
                return (
                  <g key={mark.id}>
                    <ellipse
                      cx={x + width / 2}
                      cy={y + height / 2}
                      rx={width / 2}
                      ry={height / 2}
                      fill={
                        active
                          ? "color-mix(in srgb, var(--color-image-annotation) 7%, transparent)"
                          : "none"
                      }
                      stroke={ANNOTATION_COLOR}
                      strokeWidth={Math.max(3, label.radius / 5) * (active ? 1.5 : 1)}
                      opacity={selected && !active ? 0.65 : 1}
                      pointerEvents="none"
                    />
                    <g
                      data-mark-id={mark.id}
                      role="button"
                      aria-label={`Select annotation ${priorMarks.length + index + 1}`}
                      aria-pressed={active}
                      tabIndex={busy ? -1 : 0}
                      style={{ cursor: "move" }}
                      onFocus={() => setSelected(mark.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          focusComment(mark.id);
                        }
                      }}
                    >
                      <circle
                        cx={label.x}
                        cy={label.y}
                        r={label.radius}
                        fill={ANNOTATION_COLOR}
                        stroke={active ? "var(--color-white)" : "none"}
                        strokeWidth={2 / fit}
                      />
                      <text
                        x={label.x}
                        y={label.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="var(--color-white)"
                        fontSize={label.radius * 1.2}
                        fontFamily="system-ui, sans-serif"
                        fontWeight="600"
                      >
                        {priorMarks.length + index + 1}
                      </text>
                    </g>
                    {active &&
                      (["nw", "ne", "sw", "se"] as const).map((corner) => (
                        <rect
                          key={corner}
                          data-mark-id={mark.id}
                          data-handle={corner}
                          x={(corner.includes("w") ? x : x + width) - handleSize / 2}
                          y={(corner.includes("n") ? y : y + height) - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          rx={2 / fit}
                          fill="var(--color-white)"
                          stroke={ANNOTATION_COLOR}
                          strokeWidth={1.5 / fit}
                          style={{
                            cursor:
                              corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                          }}
                        />
                      ))}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <p className="mt-2 truncate text-center text-xs text-white/80">{name}</p>
        {marks.length + priorMarks.length > 0 && (
          <aside
            aria-label="Annotation comments"
            className={`absolute flex w-72 max-w-[86vw] flex-col gap-3 ${sideBySide ? "left-[calc(100%+24px)] top-0" : "left-1/2 top-[calc(100%+36px)] -translate-x-1/2"}`}
            style={{ maxHeight: sideBySide ? size.height * fit : 192 }}
          >
            <div className="min-h-0 space-y-3 overflow-y-auto">
              {priorMarks.map((mark, index) => (
                <p
                  key={mark.id}
                  className="rounded-lg border border-border bg-background p-3 text-sm text-foreground whitespace-pre-wrap"
                >
                  <span className="font-medium text-image-annotation">{index + 1}.</span>{" "}
                  {mark.comment || "No comment"}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Part of the sent image
                  </span>
                </p>
              ))}
              {marks.map((mark, index) => (
                <div key={mark.id} className="group flex items-start gap-2">
                  <button
                    type="button"
                    aria-label={`Focus comment ${priorMarks.length + index + 1}`}
                    className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-image-annotation text-xs font-medium text-white"
                    disabled={busy}
                    onClick={() => focusComment(mark.id)}
                  >
                    {priorMarks.length + index + 1}
                  </button>
                  <div
                    className={`min-w-0 flex-1 rounded-lg border bg-background text-foreground ${selected === mark.id ? "border-image-annotation" : "border-border"}`}
                  >
                    <Textarea
                      unstyled
                      size="sm"
                      ref={(element) => {
                        if (element) commentRefs.current.set(mark.id, element);
                        else commentRefs.current.delete(mark.id);
                      }}
                      aria-label={`Comment ${priorMarks.length + index + 1}`}
                      placeholder="What should change?"
                      value={mark.comment}
                      maxLength={8_000}
                      disabled={busy}
                      onFocus={() => {
                        setSelected(mark.id);
                        commentBefore.current = marks;
                      }}
                      onBlur={() => {
                        const before = commentBefore.current;
                        commentBefore.current = null;
                        if (
                          before &&
                          before.find((candidate) => candidate.id === mark.id)?.comment !==
                            mark.comment
                        )
                          record(before);
                      }}
                      onChange={(event) =>
                        setMarks((current) =>
                          current.map((candidate) =>
                            candidate.id === mark.id
                              ? { ...candidate, comment: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      variant="overlay"
                      size="icon-xs"
                      aria-label={`Delete annotation ${priorMarks.length + index + 1}`}
                      disabled={busy}
                      onClick={() => {
                        record(marks);
                        setMarks(marks.filter((candidate) => candidate.id !== mark.id));
                        if (selected === mark.id) setSelected(null);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
        {error && (
          <div className="mt-2 flex flex-col items-center gap-2">
            <p role="alert" className="text-center text-sm text-white">
              {error}
            </p>
            <Button variant="overlay" size="sm" disabled={busy} onClick={onDiscard}>
              Discard unsaved changes
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
