import { createContext, useContext, useState, useMemo } from "react";
import { Pressable, View } from "react-native";
import ImageViewing from "react-native-image-viewing";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMediaActions } from "../state/mediaActions";
import { AppText } from "./AppText";
import { SymbolView } from "./AppSymbol";
import type { ResolvedFilePreviewSource } from "./FilePreviewModal.types";
import { MediaActionsMenu } from "./MediaActionsMenu";
import { MediaSourceCaption } from "./MediaSourceCaption";

type MediaImagePreviewProps = {
  readonly source: ResolvedFilePreviewSource;
  readonly onRequestClose: () => void;
};

const ImagePreviewContext = createContext<
  | (MediaImagePreviewProps & {
      readonly index: number;
      readonly count: number;
      readonly navigate: (direction: -1 | 1) => void;
    })
  | null
>(null);

function ImagePreviewHeader() {
  const props = useContext(ImagePreviewContext)!;
  const insets = useSafeAreaInsets();
  const mediaActions = useMediaActions(props.source.actionsSource, props.onRequestClose);
  return (
    <View className="bg-black/70" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-3">
        <AppText className="flex-1 text-base text-white" numberOfLines={2}>
          {props.source.name ?? "Image"}
          {props.count > 1 ? ` (${props.index + 1}/${props.count})` : ""}
        </AppText>
        {props.count > 1
          ? ([-1, 1] as const).map((direction) => (
              <Pressable
                key={direction}
                accessibilityRole="button"
                accessibilityLabel={direction === -1 ? "Previous image" : "Next image"}
                onPress={() => props.navigate(direction)}
                className="min-h-11 min-w-11 items-center justify-center"
              >
                <SymbolView
                  name={direction === -1 ? "chevron.left" : "chevron.right"}
                  size={20}
                  tintColor="#ffffff"
                  type="monochrome"
                />
              </Pressable>
            ))
          : null}
        <MediaActionsMenu media={mediaActions} inModal />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close image"
          onPress={props.onRequestClose}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <SymbolView name="xmark" size={20} tintColor="#ffffff" type="monochrome" />
        </Pressable>
      </View>
      <MediaSourceCaption source={mediaActions.title} />
    </View>
  );
}

/** Keeps media actions with the complete gallery, wrapping in either direction. */
export function MediaImagePreview(props: MediaImagePreviewProps) {
  const gallery = props.source.gallery ?? [props.source];
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      gallery.findIndex((item) => item.uri === props.source.uri),
    ),
  );
  const selected = gallery[index] ?? props.source;
  const context = useMemo(
    () => ({
      ...props,
      source: selected,
      index,
      count: gallery.length,
      navigate: (direction: -1 | 1) =>
        setIndex((current) => (current + direction + gallery.length) % gallery.length),
    }),
    [props, selected, index, gallery.length],
  );
  return (
    <ImagePreviewContext value={context}>
      <ImageViewing
        images={gallery.map((item) => ({ uri: item.uri }))}
        imageIndex={index}
        onImageIndexChange={setIndex}
        visible
        presentationStyle="fullScreen"
        onRequestClose={props.onRequestClose}
        swipeToCloseEnabled={false}
        doubleTapToZoomEnabled
        HeaderComponent={ImagePreviewHeader}
      />
    </ImagePreviewContext>
  );
}
