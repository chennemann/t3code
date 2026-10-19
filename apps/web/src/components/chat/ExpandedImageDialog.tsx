import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { ChevronLeftIcon, ChevronRightIcon, CircleIcon, XIcon } from "lucide-react";
import { Image as ImageGlyph, Text as TextGlyph } from "lucide";
import { MorphIcon } from "~/components/MorphIcon";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  wrapExpandedImageIndex,
  type ExpandedImageItem,
  type ExpandedImagePreview,
} from "./ExpandedImagePreview";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import { useAssetUrlRefresh, useAssetUrlState } from "../../assets/assetUrls";
import { OpenMediaLink } from "../media/OpenMediaLink";
import { MediaActions, type MediaActionSource } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { isContextMenuOpen } from "../../contextMenuFallback";
import {
  SnapShotAccessibilityData,
  SnapShotContentsButton,
  snapShotAccessibilityDetails,
} from "./SnapShotAttachmentDetails";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZoomableImage, type ZoomableImageHandle } from "./ZoomableImage";
import { composerFloatingLayerProps } from "./composerEventScope";
import { ImageAnnotationEditor, type ImageAnnotationEditorHandle } from "./ImageAnnotationEditor";
import { attachImageAnnotation } from "../../lib/attachImageAnnotation";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import type { ImageAnnotation } from "../../lib/imageAnnotations";
import { useClientSettings } from "../../hooks/useSettings";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
  composerTarget?: ComposerThreadTarget | undefined;
}

const EXPANDED_MEDIA_STATE_CLASS_NAME =
  "flex aspect-auto h-48 min-h-0 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-black p-6 text-center text-sm text-white shadow-2xl";

function ExpandedMediaFailure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
      {children}
    </div>
  );
}

function ExpandedVideo({ item }: { readonly item: ExpandedImageItem }) {
  const asset = item.actionsSource?.asset;
  const assetUrl = useAssetUrlState(asset?.environmentId ?? null, asset?.resource ?? null);
  const refreshAssetUrl = useAssetUrlRefresh(asset?.environmentId ?? null, asset?.resource ?? null);
  const src = asset
    ? assetUrl._tag === "Success"
      ? assetUrl.url + (item.srcFragment ?? "")
      : null
    : item.src;
  return (
    <MediaVideoPlayer
      src={src}
      label={item.name}
      sourceFailed={assetUrl._tag === "Failure"}
      originalUrl={item.originalUrl}
      preload="metadata"
      autoPlay={item.autoPlay ?? true}
      className="block max-h-[var(--media-height)] max-w-[var(--media-width)] text-center"
      videoClassName="aspect-auto max-h-[var(--media-height)] w-auto max-w-[var(--media-width)] rounded-lg border border-border/70 shadow-2xl"
      stateClassName={EXPANDED_MEDIA_STATE_CLASS_NAME}
      onRetry={asset ? refreshAssetUrl : undefined}
    />
  );
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
  composerTarget,
}: ExpandedImageDialogProps) {
  const imageOpenAction = useClientSettings((settings) => settings.imageOpenAction);
  const [annotating, setAnnotating] = useState(() =>
    Boolean(
      composerTarget &&
      !preview.annotationDisabled &&
      preview.images[preview.index]?.type !== "video" &&
      imageOpenAction === "annotate",
    ),
  );
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationInitialMarks, setAnnotationInitialMarks] = useState<
    ReadonlyArray<ImageAnnotation>
  >(
    () =>
      preview.images[preview.index]?.annotations?.slice(
        preview.images[preview.index]?.burnedAnnotationCount ?? 0,
      ) ?? [],
  );
  const annotationDrafts = useRef(new Map<string, ImageAnnotation[]>());
  const [savedAnnotations, setSavedAnnotations] = useState<
    Record<string, ReadonlyArray<ImageAnnotation>>
  >({});
  const savedComposerIds = useRef(new Map<string, string>());
  const closeDestination = useRef<"close" | "zoom" | -1 | 1>("close");
  const annotationEditorRef = useRef<ImageAnnotationEditorHandle>(null);
  const [imageOffset, setImageOffset] = useState(0);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [accessibilityDetailsSrc, setAccessibilityDetailsSrc] = useState<string | null>(null);
  const zoomableImageRef = useRef<ZoomableImageHandle>(null);
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // The offset accumulates without bound, so wrap it into range in both directions:
  // JavaScript `%` keeps the sign of the dividend, and a negative index blanks the dialog.
  const imageCount = preview.images.length;
  const index = wrapExpandedImageIndex(preview.index + imageOffset, imageCount);
  const item = preview.images[index];
  const visibleAnnotations = item?.src
    ? (savedAnnotations[item.src] ?? item.annotations)
    : undefined;
  const priorAnnotations = item?.annotations?.slice(0, item.burnedAnnotationCount ?? 0) ?? [];
  const source: MediaActionSource = item?.actionsSource ?? {
    kind: item?.type === "video" ? "video" : "image",
    name: item?.name ?? "Media",
    src: item?.src ?? null,
  };
  const openFile = source.onOpenFile;
  const actionsSource: MediaActionSource = openFile
    ? {
        ...source,
        onOpenFile: () => {
          openFile();
          onClose();
        },
      }
    : source;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

  const requestClose = useCallback(() => {
    if (annotationBusy) return;
    if (annotating) {
      void annotationEditorRef.current?.close();
    } else {
      onClose();
    }
  }, [annotating, annotationBusy, onClose]);

  // The element that opened the preview gets focus back on close. Without
  // this a close button click leaves focus on the unmounted dialog, and the
  // composer that owned the opener reads that as a blur and rests.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (annotating) return;
    if (event.defaultPrevented || isContextMenuOpen() || event.target instanceof HTMLVideoElement)
      return;
    if (zoomableImageRef.current?.pan(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (preview.images.length <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    navigateImage(1);
  };

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || isContextMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [requestClose]);

  if (!item) return null;
  const mediaLabel = item.type === "video" ? "video" : "image";
  const openOriginalLink =
    item.originalUrl && resolveExternalWebLinkHost(item.originalUrl) !== null ? (
      <OpenMediaLink originalUrl={item.originalUrl} />
    ) : null;
  const accessibilityDetails = item.source ? snapShotAccessibilityDetails(item.source) : undefined;
  const showingAccessibilityDetails =
    Boolean(accessibilityDetails) && accessibilityDetailsSrc === item.src;
  const contentsLabel = showingAccessibilityDetails
    ? "Show screenshot"
    : accessibilityDetails?.format === "json"
      ? "Show accessibility JSON"
      : "Show extracted text";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1 h-full max-h-[92vh] w-[92vw] max-w-[92vw] items-center justify-center overflow-visible [--media-width:92vw] [--media-height:min(86vh,calc(100vh-160px))] sm:[--media-width:calc(92vw-96px)]"
        onKeyDown={onKeyDown}
        initialFocus={closeButtonRef}
        finalFocus={() => returnFocusTarget}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <DialogTitle className="sr-only">Expanded {mediaLabel} preview</DialogTitle>
        {annotating && item.src && composerTarget ? (
          <ImageAnnotationEditor
            ref={annotationEditorRef}
            key={item.src}
            src={item.src}
            name={item.name}
            initialMarks={annotationInitialMarks}
            priorMarks={priorAnnotations}
            onDraftChange={(marks) => {
              if (item.src) annotationDrafts.current.set(item.src, marks);
            }}
            onBusyChange={setAnnotationBusy}
            onDiscard={() => {
              if (item.src) {
                const saved = savedAnnotations[item.src] ?? item.annotations ?? [];
                annotationDrafts.current.set(
                  item.src,
                  saved.slice(item.burnedAnnotationCount ?? 0),
                );
              }
              setAnnotating(false);
            }}
            navigation={
              imageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="overlay"
                    size="icon-sm"
                    aria-label="Previous media"
                    disabled={annotationBusy}
                    onClick={() => {
                      closeDestination.current = -1;
                      void annotationEditorRef.current?.close();
                    }}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <span className="text-xs" aria-live="polite">
                    {index + 1}/{imageCount}
                  </span>
                  <Button
                    variant="overlay"
                    size="icon-sm"
                    aria-label="Next media"
                    disabled={annotationBusy}
                    onClick={() => {
                      closeDestination.current = 1;
                      void annotationEditorRef.current?.close();
                    }}
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              ) : undefined
            }
            onZoom={() => {
              closeDestination.current = "zoom";
              void annotationEditorRef.current?.close();
            }}
            onApply={async ({ annotations, changed }) => {
              const savedMarks = [...priorAnnotations, ...annotations];
              const destination = closeDestination.current;
              closeDestination.current = "close";
              const id = changed
                ? await attachImageAnnotation(
                    composerTarget,
                    {
                      src: item.src!,
                      name: item.name,
                      burnedAnnotationCount: item.burnedAnnotationCount,
                    },
                    savedMarks,
                    item.composerImageId ?? savedComposerIds.current.get(item.src!),
                  )
                : undefined;
              if (id) savedComposerIds.current.set(item.src!, id);
              setSavedAnnotations((saved) => ({ ...saved, [item.src!]: savedMarks }));
              if (destination === "zoom") {
                setAnnotating(false);
              } else if (typeof destination === "number") {
                const next =
                  preview.images[wrapExpandedImageIndex(index + destination, imageCount)]!;
                if (next.type === "video" || next.src === null) setAnnotating(false);
                setAnnotationInitialMarks(
                  annotationDrafts.current.get(next.src!) ??
                    next.annotations?.slice(next.burnedAnnotationCount ?? 0) ??
                    [],
                );
                navigateImage(destination);
              } else onClose();
            }}
          />
        ) : (
          <>
            <Button
              type="button"
              ref={closeButtonRef}
              size="icon-sm"
              variant="media-close"
              className="absolute right-0 top-0 z-20"
              onClick={onClose}
              aria-label={`Close ${mediaLabel} preview`}
            >
              <XIcon />
            </Button>
            {preview.images.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="media-navigation"
                className="left-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
                aria-label="Previous media"
                onClick={() => navigateImage(-1)}
              >
                <ChevronLeftIcon className="size-5" />
              </Button>
            )}
            <MediaActions source={actionsSource}>
              <div className="relative isolate z-10 flex max-h-full max-w-[var(--media-width)] flex-col items-center">
                {item.type === "video" ? (
                  <ExpandedVideo key={index} item={item} />
                ) : showingAccessibilityDetails ? (
                  accessibilityDetails ? (
                    <SnapShotAccessibilityData
                      details={accessibilityDetails}
                      className="h-[min(var(--media-height),40rem)] w-[min(var(--media-width),42rem)] transition-opacity duration-140 ease-out starting:opacity-0 rounded-lg border border-border/70 bg-background p-4 text-xs leading-5 shadow-2xl motion-reduce:transition-none"
                    />
                  ) : null
                ) : item.src === null || failedImageSrc === item.src ? (
                  <ExpandedMediaFailure>
                    <p>
                      {openOriginalLink
                        ? "This image could not be loaded."
                        : "Image unavailable. The file may have been moved or deleted."}
                    </p>
                    {openOriginalLink}
                  </ExpandedMediaFailure>
                ) : (
                  <ZoomableImage
                    ref={zoomableImageRef}
                    key={`${index}:${item.src}`}
                    src={item.src}
                    name={item.name}
                    annotations={visibleAnnotations}
                    burnedAnnotationCount={item.burnedAnnotationCount}
                    onError={() => setFailedImageSrc(item.src)}
                  />
                )}
                <div className="mt-2 flex max-w-[var(--media-width)] items-center justify-center gap-1.5 text-xs text-white/80 max-sm:px-10">
                  <span className="truncate" aria-live="polite" aria-atomic="true">
                    {item.name}
                    {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
                  </span>
                  {accessibilityDetails && item.source ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            aria-label={contentsLabel}
                            aria-pressed={showingAccessibilityDetails}
                            onClick={() =>
                              setAccessibilityDetailsSrc(
                                showingAccessibilityDetails ? null : item.src,
                              )
                            }
                            size="icon-micro"
                            variant="overlay"
                          />
                        }
                      >
                        <MorphIcon
                          className="size-3"
                          aria-hidden="true"
                          icon={showingAccessibilityDetails ? ImageGlyph : TextGlyph}
                        />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{contentsLabel}</TooltipPopup>
                    </Tooltip>
                  ) : item.source ? (
                    <SnapShotContentsButton source={item.source} side="top" />
                  ) : null}
                </div>
                {composerTarget &&
                  !preview.annotationDisabled &&
                  item.type !== "video" &&
                  item.src &&
                  failedImageSrc !== item.src &&
                  !showingAccessibilityDetails && (
                    <div className="mt-3 flex justify-center">
                      <Button
                        variant="overlay"
                        size="sm"
                        onClick={() => {
                          setAnnotationInitialMarks(
                            annotationDrafts.current.get(item.src!) ??
                              item.annotations?.slice(item.burnedAnnotationCount ?? 0) ??
                              [],
                          );
                          setAnnotating(true);
                        }}
                      >
                        <CircleIcon />
                        {(visibleAnnotations?.length ?? 0) > priorAnnotations.length
                          ? "Edit annotations"
                          : "Annotate image"}
                      </Button>
                    </div>
                  )}
                {visibleAnnotations?.length && item.type !== "video" ? (
                  <aside
                    aria-label="Saved annotation comments"
                    className="absolute right-0 bottom-16 z-20 max-h-48 w-72 max-w-[85vw] space-y-2 overflow-auto rounded-lg border border-border bg-background p-3 text-sm text-foreground shadow-lg"
                  >
                    {visibleAnnotations.map((mark, index) => (
                      <p key={mark.id} className="whitespace-pre-wrap break-words">
                        <span className="font-semibold text-image-annotation">{index + 1}.</span>{" "}
                        {mark.comment || "No comment"}
                      </p>
                    ))}
                  </aside>
                ) : null}
              </div>
            </MediaActions>
            {preview.images.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="media-navigation"
                className="right-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
                aria-label="Next media"
                onClick={() => navigateImage(1)}
              >
                <ChevronRightIcon className="size-5" />
              </Button>
            )}
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
});
