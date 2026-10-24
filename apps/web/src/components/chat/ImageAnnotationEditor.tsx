import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
  type ReactNode,
} from "react";
import { SquareDashedIcon, Trash2Icon, XIcon, ZoomInIcon } from "lucide-react";
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
  initialAction = "annotate",
  onDiscard,
  navigation,
  details,
  onNavigate,
  ref,
}: {
  src: string;
  name: string;
  onApply: (result: ImageAnnotationResult) => Promise<void>;
  initialMarks?: ReadonlyArray<ImageAnnotation> | undefined;
  priorMarks?: ReadonlyArray<ImageAnnotation>;
  onDraftChange: (marks: ImageAnnotation[]) => void;
  onBusyChange: (busy: boolean) => void;
  initialAction?: "zoom" | "annotate";
  onDiscard: () => void;
  navigation?: ReactNode;
  details?: ReactNode;
  onNavigate?: ((direction: -1 | 1) => void) | undefined;
  ref?: Ref<ImageAnnotationEditorHandle> | undefined;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const [action, setAction] = useState(initialAction);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
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
  // Reserve comment space so the first rectangle cannot resize the image mid-drag.
  const maxWidth = sideBySide ? stageSize.width - 624 : stageSize.width;
  const maxHeight = sideBySide ? stageSize.height : Math.max(1, stageSize.height - 220);
  const fit = Math.min(maxWidth / (size.width || 1), maxHeight / (size.height || 1), 1);
  const scale = fit * zoom;
  const isZoomAction = (ctrl: boolean) => (action === "zoom") !== ctrl;
  const changeZoom = useStableCallback((next: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    const previous = zoomRef.current;
    const clamped = Math.min(32, Math.max(1, next));
    if (!viewport || previous === clamped) return;
    const bounds = viewport.getBoundingClientRect();
    const x = (clientX ?? bounds.left + viewport.clientWidth / 2) - bounds.left;
    const y = (clientY ?? bounds.top + viewport.clientHeight / 2) - bounds.top;
    zoomAnchor.current = {
      x: (viewport.scrollLeft + x) / previous,
      y: (viewport.scrollTop + y) / previous,
      clientX: x,
      clientY: y,
    };
    zoomRef.current = clamped;
    setZoom(clamped);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restore the DOM scroll position around the pointer after zoom resizes the image.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = zoomAnchor.current;
    if (!viewport || !anchor) return;
    viewport.scrollLeft = anchor.x * zoom - anchor.clientX;
    viewport.scrollTop = anchor.y * zoom - anchor.clientY;
    zoomAnchor.current = null;
  }, [zoom]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Track the physical Ctrl key and clear it when the window loses focus.
  useEffect(() => {
    const key = (event: KeyboardEvent) => setCtrlPressed(event.ctrlKey);
    const blur = () => setCtrlPressed(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Register a non-passive DOM wheel listener to prevent browser zoom for Ctrl image gestures.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      // Ctrl belongs to the image action, including when a wheel cannot annotate.
      if (event.ctrlKey) event.preventDefault();
      if ((action === "zoom") === event.ctrlKey || busy || gesture.current || panRef.current)
        return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      changeZoom(zoomRef.current * Math.exp(-delta * 0.002), event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [action, busy, changeZoom]);
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the external stage dimensions and disconnect on unmount.
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
        (end.x - active.start.x) * size.width * scale,
        (end.y - active.start.y) * size.height * scale,
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
                    size,
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
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const viewport = viewportRef.current;
          if (viewport && zoom > 1 && viewport.scrollWidth > viewport.clientWidth) {
            viewport.scrollLeft += event.key === "ArrowLeft" ? -40 : 40;
          } else onNavigate?.(event.key === "ArrowLeft" ? -1 : 1);
          event.preventDefault();
          return;
        }
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
          aria-label={
            action === "annotate"
              ? "Zoom image"
              : marks.length
                ? "Edit annotations"
                : "Annotate image"
          }
          className="absolute right-10 -top-10 z-20"
          disabled={busy}
          onClick={() => setAction((current) => (current === "zoom" ? "annotate" : "zoom"))}
        >
          {action === "annotate" ? <ZoomInIcon /> : <SquareDashedIcon />}
          <span className="sr-only">
            {action === "zoom"
              ? marks.length
                ? "Edit annotations"
                : "Annotate image"
              : "Zoom image"}
          </span>
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
        <div
          ref={viewportRef}
          role="region"
          aria-label={`${name}, zoomable image`}
          tabIndex={0}
          className="overflow-auto overscroll-contain"
          style={{
            width: size.width * fit,
            height: size.height * fit,
            cursor: isZoomAction(ctrlPressed) ? (zoom > 1 ? "grab" : "zoom-in") : "crosshair",
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey) return;
            if (event.key === "+" || event.key === "=") changeZoom(zoomRef.current * 1.5);
            else if (event.key === "-") changeZoom(zoomRef.current / 1.5);
            else if (event.key === "0") changeZoom(1);
            else if ((event.key === "Enter" || event.key === " ") && action === "zoom") {
              if (!event.repeat) changeZoom(zoomRef.current > 1 ? 1 : 2);
            } else return;
            event.preventDefault();
          }}
          onClick={(event) => {
            if (busy || suppressClick.current || !isZoomAction(event.ctrlKey)) return;
            changeZoom(zoomRef.current > 1 ? 1 : 2, event.clientX, event.clientY);
          }}
          onPointerDown={(event) => {
            if (busy || event.button !== 0 || !isZoomAction(event.ctrlKey)) return;
            suppressClick.current = false;
            const viewport = event.currentTarget;
            panRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: viewport.scrollLeft,
              top: viewport.scrollTop,
            };
            viewport.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 4)
              suppressClick.current = true;
            event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
            event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
          }}
          onPointerUp={(event) => {
            if (panRef.current?.pointerId !== event.pointerId) return;
            panRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            panRef.current = null;
          }}
        >
          <div
            className="relative select-none"
            style={{ width: size.width * scale, height: size.height * scale }}
          >
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
                aria-label="Draw numbered rectangles on the image"
                className="absolute inset-0 h-full w-full touch-none"
                viewBox={`0 0 ${size.width} ${size.height}`}
                onPointerDown={(event) => {
                  if (busy || event.button !== 0 || gesture.current || isZoomAction(event.ctrlKey))
                    return;
                  event.stopPropagation();
                  suppressClick.current = true;
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
                      {
                        id: nextId,
                        ...annotationRect(start, start, size),
                        comment: "",
                        imageSize: size,
                      },
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
                        return {
                          ...mark,
                          imageSize: mark.imageSize ?? size,
                          ...annotationRect(active.anchor ?? active.start, end, size),
                        };
                      const original = active.before.find(
                        (candidate) => candidate.id === active.id,
                      );
                      return original
                        ? moveAnnotation(
                            { ...original, imageSize: original.imageSize ?? size },
                            {
                              x: end.x - active.start.x,
                              y: end.y - active.start.y,
                            },
                          )
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
                    handleSize = 9 / scale;
                  return (
                    <g key={mark.id}>
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
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
                          strokeWidth={2 / scale}
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
                            rx={2 / scale}
                            fill="var(--color-white)"
                            stroke={ANNOTATION_COLOR}
                            strokeWidth={1.5 / scale}
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
        </div>
        <p className="mt-2 truncate text-center text-xs text-white/80">{name}</p>
        {details}
        <p className="mt-1 text-center text-xs text-white/80">
          {action === "annotate"
            ? "Drag to annotate. Hold Ctrl to zoom or drag to pan."
            : "Click or scroll to zoom, drag to pan. Hold Ctrl to annotate."}{" "}
          {Math.round(zoom * 100)}%
        </p>
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
                              ? {
                                  ...candidate,
                                  comment: event.target.value,
                                  ...(loaded ? { imageSize: candidate.imageSize ?? size } : {}),
                                }
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
